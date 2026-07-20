import { searchRecipes, type RecipeCandidate, type SpoonacularResult } from "@/lib/spoonacular";

/** The six cuisines the F-01 spike verified return full results. */
export const CUISINES = Object.freeze(["italian", "mexican", "chinese", "greek", "thai", "french"] as const);

export type Cuisine = (typeof CUISINES)[number];

/** A candidate carrying the cuisine the app *asked for* — never the response's derived `cuisines[]`. */
export interface ProposedRecipe extends RecipeCandidate {
  requestedCuisine: string;
  excerpt: string | null;
}

type FailureReason = Extract<SpoonacularResult, { ok: false }>["reason"];

export type ProposalSetResult =
  | { ok: true; proposals: ProposedRecipe[]; degraded: boolean }
  | { ok: false; reason: FailureReason; status: number };

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
// daily requirements", "Watching your figure?" — which lead into macro talk regardless.
const NUTRITION_CLAIM = /\bcovers?\s*\d+%|\b\d+%\s*of\s+your\s+daily|watching your figure/i;

// Anchor text survives tag stripping, so the provider's own backlink wording has to be cut too.
const PROVIDER_MENTION = /spoonacular/i;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    }
    if (lower.startsWith("#")) {
      return String.fromCodePoint(Number(lower.slice(1)));
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

function toProposed(recipes: RecipeCandidate[], requestedCuisine: string): ProposedRecipe[] {
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

/**
 * Exactly two cuisine-pinned calls composed into one ordered set of up to 4.
 *
 * Returns whatever survives validation and dedup — 0 to 4 — rather than padding or
 * failing: the PRD specifies "up to 4". One failed call degrades to a single-cuisine
 * set, which beats an error screen; only a double failure is an error.
 */
export async function buildColdStartSet(): Promise<ProposalSetResult> {
  const [cuisineA, cuisineB] = pickCuisinePair();

  // Concurrent: the calls are independent and the latency is user-facing.
  const [resultA, resultB] = await Promise.all([
    searchRecipes({ cuisine: cuisineA, number: PER_CALL, sort: "random", offset: randomOffset() }),
    searchRecipes({ cuisine: cuisineB, number: PER_CALL, sort: "random", offset: randomOffset() }),
  ]);

  if (!resultA.ok && !resultB.ok) {
    return { ok: false, reason: resultA.reason, status: resultA.status };
  }

  const groupA = resultA.ok ? toProposed(resultA.recipes, cuisineA) : [];
  const groupB = resultB.ok ? toProposed(resultB.recipes, cuisineB) : [];

  const proposals = interleave(groupA, groupB).slice(0, SET_SIZE);

  // Coverage, not call success: a call can return 200 with zero results (a thin cuisine, or
  // an offset past its corpus), which yields a single-cuisine set from two healthy calls.
  // US-02's criterion is two cuisines in the *set*, so that is what `degraded` reports.
  const cuisinesCovered = new Set(proposals.map((p) => p.requestedCuisine)).size;

  return { ok: true, proposals, degraded: cuisinesCovered < 2 };
}
