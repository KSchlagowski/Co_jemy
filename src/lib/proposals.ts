import { getRecipeById, searchRecipes, type RecipeCandidate, type SpoonacularResult } from "@/lib/spoonacular";
import type { RecentLike, StaleLike } from "@/lib/history";

/** The six cuisines the F-01 spike verified return full results. */
export const CUISINES = Object.freeze(["italian", "mexican", "chinese", "greek", "thai", "french"] as const);

export type Cuisine = (typeof CUISINES)[number];

/**
 * A candidate carrying the cuisine the app *asked for* — never the response's derived
 * `cuisines[]`. Null on by-id re-fetches (slots 1/2), which pin no cuisine.
 */
export interface ProposedRecipe extends RecipeCandidate {
  requestedCuisine: string | null;
  excerpt: string | null;
}

type FailureReason = Extract<SpoonacularResult, { ok: false }>["reason"];

export type ProposalSetResult =
  | { ok: true; proposals: ProposedRecipe[]; degraded: boolean }
  | { ok: false; reason: FailureReason; status: number };

/** 1 = recently liked · 2 = liked, not proposed in ≥2 weeks · 3 = taste match · 4 = discovery. */
export interface SlottedRecipe extends ProposedRecipe {
  slot: 1 | 2 | 3 | 4;
}

export type PersonalizedSetResult =
  | { ok: true; proposals: SlottedRecipe[]; degraded: boolean }
  | { ok: false; reason: FailureReason; status: number };

/** History shapes read by `@/lib/history` — the engine itself never touches the DB. */
export interface PersonalizedHistory {
  recentLikes: RecentLike[];
  staleLikes: StaleLike[];
  dislikedIds: number[];
  topCuisine: string | null;
}

// Slot-activation thresholds: tunable defaults decided in the S-05 plan, exported so the
// endpoint and future tuning share one declaration. Tests assert behavior from PRD/research
// values, never these constants (mirror-test discipline).
/** Slot 1 activates at the first like. */
export const SLOT1_MIN_LIKES = 1;
/** Slot 2 wants a like not proposed in ≥ this many days (PRD "≥2 weeks"); the endpoint derives the cutoff. */
export const SLOT2_STALE_DAYS = 14;
/** Slot 3's profile needs this many likes plus a non-empty cuisine affinity (PRD Socrates hint). */
export const SLOT3_MIN_LIKES = 5;

/** Two calls is both the floor and the ceiling — call count dominates quota cost. */
const PER_CALL = 20;
const SET_SIZE = 4;

// Not the provider's 0-900 clamp. Measured 2026-07-20 across all six cuisines: at offset 50
// `chinese`, `greek`, and `thai` return zero results, which silently yields a single-cuisine
// set while still spending both quota points. All six return results at offset 20, so that is
// the bound. `sort=random` carries most of the variety; this is the second axis.
const MAX_OFFSET = 20;

const MAX_EXCERPT = 160;
// Below this, a salvaged clause carries less than it costs in awkwardness — drop it.
const MIN_EXCERPT = 40;

// Spoonacular summaries routinely read: "...has 452 calories, 23g of protein..."
// Cutting at the first such figure keeps the no-macros non-goal intact (PRD Non-Goals).
const NUTRITION_FIGURE = /\b\d+\s*(k?cal|calories|g\s+of\s+(protein|fat|carbo?hydrates?)|grams?\s+of)/i;

// Nutrition claims the provider phrases without a bare macro figure — "covers 12% of your
// daily requirements", "Watching your figure?", "is high in protein", "if you're following a
// gluten free diet" — which are health claims in their own right and lead into macro talk
// regardless. This list is *known incomplete*: it is enumerated from sampled payloads, not
// derived from a provider schema, so a new phrasing leaks silently. Widen it on sight rather
// than assuming the current set is closed (see context/foundation/lessons.md).
const NUTRITION_CLAIM =
  /\bcovers?\s*\d+%|\b\d+%\s*of\s+your\s+daily|watching your figure|\b(?:high|low|rich)\s+in\s+\w+|\b(?:gluten|dairy|lactose)[-\s]free\b|\bhealthy\b|\bdiet\b|\bcalorie|\bnutrition/i;

// Anchor text survives tag stripping, so the provider's own backlink wording has to be cut too.
const PROVIDER_MENTION = /spoonacular/i;

// Named entities left undecoded render as literal "Cr&egrave;me" on the card, so the table has
// to cover what food writing actually contains — typographic punctuation and Latin-1 accents —
// not just the five structural XML entities. Numeric forms (&#233; / &#xE9;) are handled above.
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  deg: "°",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  agrave: "à",
  aacute: "á",
  acirc: "â",
  atilde: "ã",
  auml: "ä",
  aring: "å",
  ccedil: "ç",
  egrave: "è",
  eacute: "é",
  ecirc: "ê",
  euml: "ë",
  igrave: "ì",
  iacute: "í",
  icirc: "î",
  iuml: "ï",
  ntilde: "ñ",
  ograve: "ò",
  oacute: "ó",
  ocirc: "ô",
  otilde: "õ",
  ouml: "ö",
  ugrave: "ù",
  uacute: "ú",
  ucirc: "û",
  uuml: "ü",
  szlig: "ß",
};

// String.fromCodePoint throws RangeError past 0x10FFFF, and an unvalidated numeric entity
// would turn one malformed summary into a 500 for the whole set. Out-of-range stays literal.
function fromCodePoint(value: number): string | null {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : null;
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith("#x")) {
      return fromCodePoint(Number.parseInt(lower.slice(2), 16)) ?? whole;
    }
    if (lower.startsWith("#")) {
      return fromCodePoint(Number(lower.slice(1))) ?? whole;
    }
    return ENTITIES[lower] ?? whole;
  });
}

function firstStopIndex(text: string): number {
  const indexes = [NUTRITION_FIGURE, NUTRITION_CLAIM, PROVIDER_MENTION]
    .map((pattern) => text.search(pattern))
    .filter((index) => index >= 0);
  return indexes.length > 0 ? Math.min(...indexes) : -1;
}

// Requires trailing space/end-of-string so a decimal point ("$4.62 per serving") is not
// mistaken for a sentence end — that misread truncates an excerpt to a stub like "For $4.".
function toSentenceBoundary(text: string): string {
  const pattern = /[.!?](?=\s|$)/g;
  let cut = -1;
  for (;;) {
    const match = pattern.exec(text);
    if (match === null) {
      break;
    }
    cut = match.index;
  }
  return cut > 0 ? text.slice(0, cut + 1) : text;
}

function ellipsize(text: string): string {
  return `${text.replace(/[\s,;:.-]+$/, "")}…`;
}

// Words that can't end an excerpt without reading as a truncation artifact
// ("This recipe serves 4 and has…"). Only matters on the no-sentence-boundary path.
const DANGLING =
  /(?:[\s,;:]+(?:and|or|but|with|has|have|is|are|was|were|of|the|an?|to|for|in|on|at|that|which|it|its|this|about|per|plus|only|just|contains?|covers?|serves?))+[\s,;:]*$/i;

function trimDangling(text: string): string {
  let trimmed = text.replace(/[\s,;:-]+$/, "");
  let previous: string;
  do {
    previous = trimmed;
    trimmed = trimmed.replace(DANGLING, "");
  } while (trimmed !== previous);
  return trimmed;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const head = text.slice(0, max);
  const lastSpace = head.lastIndexOf(" ");
  return ellipsize(lastSpace > 0 ? head.slice(0, lastSpace) : head);
}

/**
 * Turns the provider's HTML `summary` into a short plain-text excerpt.
 *
 * Stripping markup is necessary but not sufficient: the excerpt is also cut *before*
 * any calorie/macro figure (PRD Non-Goals) and before any provider backlink wording.
 */
export function sanitizeSummary(summary: string | null): string | null {
  if (!summary) {
    return null;
  }

  let text = decodeEntities(summary.replace(/<[^>]*>/g, " "))
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return null;
  }

  const stop = firstStopIndex(text);
  if (stop !== -1) {
    const head = toSentenceBoundary(text.slice(0, stop)).trim();
    if (/[.!?]$/.test(head)) {
      text = head;
    } else {
      // No sentence boundary before the figure — salvage a clause, or nothing at all.
      // A stub like "This recipe serves 4 and has…" reads as a bug, not an excerpt.
      const clause = trimDangling(head);
      if (clause.length < MIN_EXCERPT) {
        return null;
      }
      text = ellipsize(clause);
    }
  }

  return truncate(text, MAX_EXCERPT);
}

/** Two *distinct* cuisines; the modular step keeps them from ever colliding. */
export function pickCuisinePair(): [Cuisine, Cuisine] {
  const first = Math.floor(Math.random() * CUISINES.length);
  const step = 1 + Math.floor(Math.random() * (CUISINES.length - 1));
  return [CUISINES[first], CUISINES[(first + step) % CUISINES.length]];
}

function randomOffset(): number {
  return Math.floor(Math.random() * (MAX_OFFSET + 1));
}

function toProposed(recipes: RecipeCandidate[], requestedCuisine: string | null): ProposedRecipe[] {
  return recipes.map((recipe) => ({
    ...recipe,
    requestedCuisine,
    excerpt: sanitizeSummary(recipe.summary),
  }));
}

// A, B, A, B — so cuisine diversity is visible in the rendered order rather than buried.
// Dedupes by id (the same recipe can legitimately return under both cuisines) and lets the
// longer side finish the tail when the groups are unbalanced.
function interleave(a: ProposedRecipe[], b: ProposedRecipe[]): ProposedRecipe[] {
  const merged: ProposedRecipe[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    for (const group of [a, b]) {
      if (i >= group.length) {
        continue;
      }
      const item = group[i];
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
      }
    }
  }
  return merged;
}

type ProviderFailure = Extract<SpoonacularResult, { ok: false }>;

// quota_exhausted wins over transport reasons: it is the one failure with a distinct,
// actionable status (402), and burying it under a retryable 502 tells the user to retry
// against a budget that is already spent.
function preferFailure(failures: ProviderFailure[]): ProviderFailure {
  return failures.find((f) => f.reason === "quota_exhausted") ?? failures[0];
}

/**
 * Exactly two cuisine-pinned calls composed into one ordered set of up to 4.
 *
 * Returns whatever survives validation and dedup — 0 to 4 — rather than padding or
 * failing: the PRD specifies "up to 4". One failed call degrades to a single-cuisine
 * set, which beats an error screen; only a double failure is an error.
 *
 * `excludeIds` is the FR-009 exclusion set (👎-rated recipes) — a user with only
 * dislikes still routes here, so cold start must honor the exclusion too.
 */
export async function buildColdStartSet(excludeIds: number[] = []): Promise<ProposalSetResult> {
  const [cuisineA, cuisineB] = pickCuisinePair();

  // Concurrent: the calls are independent and the latency is user-facing.
  const [resultA, resultB] = await Promise.all([
    searchRecipes({ cuisine: cuisineA, number: PER_CALL, sort: "random", offset: randomOffset() }),
    searchRecipes({ cuisine: cuisineB, number: PER_CALL, sort: "random", offset: randomOffset() }),
  ]);

  if (!resultA.ok && !resultB.ok) {
    const failure = preferFailure([resultA, resultB]);
    return { ok: false, reason: failure.reason, status: failure.status };
  }

  const exclude = new Set(excludeIds);
  const groupA = resultA.ok
    ? toProposed(
        resultA.recipes.filter((r) => !exclude.has(r.id)),
        cuisineA,
      )
    : [];
  const groupB = resultB.ok
    ? toProposed(
        resultB.recipes.filter((r) => !exclude.has(r.id)),
        cuisineB,
      )
    : [];

  const proposals = interleave(groupA, groupB).slice(0, SET_SIZE);

  // Coverage, not call success: a call can return 200 with zero results (a thin cuisine, or
  // an offset past its corpus), which yields a single-cuisine set from two healthy calls.
  // US-02's criterion is two cuisines in the *set*, so that is what `degraded` reports.
  const cuisinesCovered = new Set(proposals.map((p) => p.requestedCuisine)).size;

  return { ok: true, proposals, degraded: cuisinesCovered < 2 };
}

// The single-object by-id result reshaped like a pool candidate; null on any failure so
// the caller can fall back to the pool uniformly.
function fromById(result: SpoonacularResult | null): ProposedRecipe | null {
  if (result === null || !result.ok || result.recipes.length === 0) {
    return null;
  }
  const [recipe] = toProposed(result.recipes, null);
  return recipe;
}

/**
 * The steady-state 4-slot set (FR-008): slot 1 = most recent like re-fetched by id,
 * slot 2 = oldest stale like distinct from slot 1, slot 3 = first pool candidate from
 * the affinity-cuisine search, slot 4 = first candidate from a different-cuisine search.
 *
 * Call shape is fixed at exactly 2 `complexSearch` + ≤2 by-id, all concurrent —
 * 2 × 1.70 + 2 × 1.00 = 5.40 pts/set ≈ 9 sets/day on the free plan. Adding calls is
 * what costs quota; the two searches' over-fetch is the buffer that absorbs exclusion,
 * dedupe, and backfill.
 *
 * Rated recipes never enter the pool: dislikes are FR-009-absolute, and likes must not
 * pose as "new" in slots 3/4 (they reach the set only via their own by-id slot).
 *
 * `degraded` is true only when an *active* slot 1–3 could not be filled as designed
 * (failed by-id, failed search, pool exhausted after exclusion). An inactive slot
 * backfilling from the pool is expected early-stage behavior, not degradation — a
 * 1-like user with healthy calls sees no warning.
 */
export async function buildPersonalizedSet(history: PersonalizedHistory): Promise<PersonalizedSetResult> {
  const { recentLikes, staleLikes, dislikedIds, topCuisine } = history;

  const slot1Id = recentLikes.length >= SLOT1_MIN_LIKES ? recentLikes[0].spoonacularId : null;
  // staleLikes arrives oldest-first (NULLs first), so the first id distinct from slot 1 is the pick.
  const slot2Id = staleLikes.find((s) => s.spoonacularId !== slot1Id)?.spoonacularId ?? null;
  const slot3Active = recentLikes.length >= SLOT3_MIN_LIKES && topCuisine !== null;

  // pickCuisinePair guarantees the two randoms differ, so slot 4's cuisine differs from
  // slot 3's in every branch: pinned-affinity (swap if collided) or both-random.
  const [randomA, randomB] = pickCuisinePair();
  const slot3Cuisine = slot3Active ? topCuisine : randomA;
  const slot4Cuisine = slot3Cuisine === randomB ? randomA : randomB;

  // Concurrent fan-out: latency ≈ one provider round trip. Inactive by-id slots cost nothing.
  const [byId1, byId2, searchA, searchB] = await Promise.all([
    slot1Id === null ? null : getRecipeById(slot1Id),
    slot2Id === null ? null : getRecipeById(slot2Id),
    searchRecipes({ cuisine: slot3Cuisine, number: PER_CALL, sort: "random", offset: randomOffset() }),
    searchRecipes({ cuisine: slot4Cuisine, number: PER_CALL, sort: "random", offset: randomOffset() }),
  ]);

  const ratedIds = new Set<number>(dislikedIds);
  for (const like of recentLikes) {
    ratedIds.add(like.spoonacularId);
  }
  for (const stale of staleLikes) {
    ratedIds.add(stale.spoonacularId);
  }

  const poolA = searchA.ok
    ? toProposed(
        searchA.recipes.filter((r) => !ratedIds.has(r.id)),
        slot3Cuisine,
      )
    : [];
  const poolB = searchB.ok
    ? toProposed(
        searchB.recipes.filter((r) => !ratedIds.has(r.id)),
        slot4Cuisine,
      )
    : [];

  const used = new Set<number>();
  const filled: (ProposedRecipe | null)[] = [null, null, null, null];
  let degraded = false;

  const takeFrom = (pool: ProposedRecipe[]): ProposedRecipe | null => {
    const candidate = pool.find((p) => !used.has(p.id));
    if (candidate) {
      used.add(candidate.id);
    }
    return candidate ?? null;
  };

  // Designed fills first. Slots 1/2: own by-id result; a failure flags degraded and leaves
  // the slot for backfill. Slots 3/4: first unused candidate from their own search's pool.
  if (slot1Id !== null) {
    const recipe = fromById(byId1);
    if (recipe !== null && !used.has(recipe.id)) {
      filled[0] = recipe;
      used.add(recipe.id);
    } else {
      degraded = true;
    }
  }
  if (slot2Id !== null) {
    const recipe = fromById(byId2);
    if (recipe !== null && !used.has(recipe.id)) {
      filled[1] = recipe;
      used.add(recipe.id);
    } else {
      degraded = true;
    }
  }

  filled[2] = takeFrom(poolA);
  if (filled[2] === null && slot3Active) {
    degraded = true;
  }
  // Slot 4 is discovery — random by definition, so falling back is never degradation.
  filled[3] = takeFrom(poolB);

  // Backfill: any unfilled slot (failed by-id, inactive slot, exhausted rule) takes the
  // next unused pool candidate; pool exhausted → the slot stays empty ("up to 4").
  const backfillPool = [...poolA, ...poolB];
  for (let i = 0; i < filled.length; i++) {
    filled[i] ??= takeFrom(backfillPool);
  }

  const proposals: SlottedRecipe[] = [];
  filled.forEach((recipe, index) => {
    if (recipe !== null) {
      proposals.push({ ...recipe, slot: (index + 1) as SlottedRecipe["slot"] });
    }
  });

  // Whole-set failure only when nothing is buildable *and* a call actually failed;
  // two healthy searches that legitimately return nothing stay an ok-but-empty set.
  if (proposals.length === 0) {
    const failures = [byId1, byId2, searchA, searchB].filter((r): r is ProviderFailure => r !== null && !r.ok);
    if (failures.length > 0) {
      const failure = preferFailure(failures);
      return { ok: false, reason: failure.reason, status: failure.status };
    }
  }

  return { ok: true, proposals, degraded };
}
