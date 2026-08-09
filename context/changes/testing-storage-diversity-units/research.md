---
date: 2026-08-09T21:07:15+02:00
researcher: Claude (10x-research)
git_commit: 7c243f34e1477f4cb7ddd8aa311cd2467c53b651
branch: master
repository: Co_jemy
topic: "Rollout Phase 1, risks #4/#5 — storage-field discipline and request-side cuisine diversity"
tags: [research, codebase, testing, vitest, spoonacular, fr-011, us-02, proposals, persistence]
status: complete
last_updated: 2026-08-09
last_updated_by: Claude (10x-research)
---

# Research: Storage-field discipline (#4) and request-side cuisine diversity (#5)

**Date**: 2026-08-09T21:07:15+02:00
**Researcher**: Claude (10x-research)
**Git Commit**: `7c243f34e1477f4cb7ddd8aa311cd2467c53b651`
**Branch**: `master`
**Repository**: Co_jemy

> Commit `7c243f3` is **not pushed** (`origin/master` is at `dc2ebe9`), so this
> document uses local `file:line` references rather than GitHub permalinks.

## Research Question

Ground rollout Phase 1 of `context/foundation/test-plan.md` for the risks #4/#5
slice (`context/changes/testing-storage-diversity-units/`):

- **#4** — where the persist/upsert path writes, and the exact column set it
  writes versus what the provider payload contains.
- **#5** — where the requested cuisines are chosen and recorded, and how the
  "≥2 cuisines" guarantee is computed.

Per test-plan §1 principle #3, the risk map names *scenarios*, not code
locations; this document is the ground truth for where the failures live.

## Assumptions stated (non-interactive session)

No clarifying questions were asked. Three scope calls were made and are stated
here so the plan can overrule them explicitly:

- **A1 — Unit layer only.** `change.md` fixes the layer as `unit`, and the
  Vitest runner is `environment: "node"` with no database. Anything requiring a
  live Postgres (actual RLS behaviour, real FK enforcement) is out of scope and
  belongs to Phase 3.
- **A2 — Extend existing files, don't create a parallel suite.** The repo has no
  shared test-helper module and every test file builds its own fixtures
  (§Architecture Insights). Both risks land as new `describe` blocks in the two
  existing files that already own the relevant surfaces, rather than in new
  `storage-*.test.ts` / `diversity-*.test.ts` files. See §Recommended anchors.
- **A3 — Migration-schema assertion is optional defence-in-depth, not the
  load-bearing test.** A schema column alone persists nothing; the *write site*
  is the necessary condition for a breach. Reasoning in §Open Questions Q1.

## Summary

**Neither risk is currently realised in the code.** Both are correctly
implemented, and both are one small edit away from silent breach. That is
exactly the shape a regression test is for — the tests must pin the *invariant*,
not certify today's behaviour.

**Risk #4.** There is exactly one write path that touches provider-derived
recipe data: `src/pages/api/proposals.ts:185-188`, a `recipes` upsert whose row
object is built by **explicit key selection** — `{ spoonacular_id, title, image }`
— from a `ProposedRecipe` that also carries `summary`, `excerpt`, `sourceName`,
`sourceUrl`, `spoonacularSourceUrl`, `requestedCuisine`, `slot`, `asDesigned`.
The `recipes` table has four columns total (`spoonacular_id`, `title`, `image`,
`created_at`) and has not changed across any of the four migrations. The regression
vector is concrete and one character wide: changing that map callback to
`{ ...p }` would ship `summary` and `excerpt` — a derived form of `summary`,
which FR-011 forbids "in any derived form" — straight into a write. Nothing in
the type system or the current test suite stops it: `src/pages/api/__tests__/proposals.test.ts:280-291`
asserts the upsert's `onConflict` option and the *proposals* row values, but
**never inspects the recipes row's keys at all**.

**Risk #5.** Cuisine diversity is established purely on the request side, exactly
as the PRD specifies. `pickCuisinePair()` (`src/lib/proposals.ts:243-248`) returns
two cuisines that are distinct by modular construction, both are pinned as
`cuisine` params, and each candidate is tagged with the cuisine *its own call*
requested via `toProposed(recipes, requestedCuisine)` (`src/lib/proposals.ts:254-260`).
The response's `cuisines[]` is not merely unused — it is **structurally
unreachable**: `toCandidate` (`src/lib/spoonacular.ts:54-72`) is a whitelist
projection of seven fields and `RecipeCandidate` has no `cuisines` member, so the
array is discarded at the HTTP boundary. The `degraded` flag *is* computed, and
correctly counts `p.requestedCuisine` (`src/lib/proposals.ts:335`).

The residual #5 exposure is not request-vs-response. It is that the request-side
guarantee (always 2 distinct cuisines pinned) **does not imply the delivered-set
guarantee** (≥2 distinct cuisines in the 4 cards). A cuisine that returns HTTP
200 with zero results — the documented behaviour of `chinese`/`greek`/`thai` past
offset 20 — collapses the set to one cuisine from two *healthy* calls. That path
sets `degraded: true`, and only the *failed-call* variant is tested today
(`src/lib/__tests__/proposals.test.ts:107-119`); the zero-results-with-200 variant
is untested.

**One inherited flaw to fix, not copy.** `src/lib/__tests__/proposals.test.ts:87`
does `expect(CUISINES).toContain(params.cuisine)` — importing the code's own
constant. That is a mirror test: shrinking `CUISINES` to one entry keeps it green.
The #5 slice must hard-code its own cuisine allow-list. Details in
§Architecture Insights → The oracle rule, and the violation at §Open Questions Q3.

## Detailed Findings

### Risk #4 — the persist path and its column set

#### The complete inventory of DB writes

Three write sites exist in `src/`. There are no RPCs, no `src/db/`, no generated
Supabase types, and `supabase/snippets/` is empty.

| # | Site | Table | Client | Columns written |
|---|------|-------|--------|-----------------|
| 1 | `src/pages/api/proposals.ts:185-188` | `recipes` | **service-role** (`createAdminClient()`, `:176`) | `spoonacular_id`, `title`, `image` |
| 2 | `src/pages/api/proposals.ts:195-202` | `proposals` | anon session | `user_id`, `spoonacular_id`, `requested_cuisine`, `requested_type` |
| 3 | `src/pages/api/ratings.ts:101-109` | `ratings` | anon session | `user_id`, `spoonacular_id`, `verdict`, `rated_at` |

Site 1 is the only one carrying provider-derived recipe content beyond the id.
Verbatim, `src/pages/api/proposals.ts:185-188`:

```ts
const { error: recipesError } = await admin.from("recipes").upsert(
  proposals.map((p) => ({ spoonacular_id: p.id, title: p.title, image: p.image })),
  { onConflict: "spoonacular_id" },
);
```

`ignoreDuplicates` is deliberately unset (defaults `false`) so the upsert
*repairs* a possibly-spoofed row — the lesson-2 hardening, explained in the
comment at `src/pages/api/proposals.ts:171-175`. `src/pages/api/__tests__/proposals.test.ts:281-283`
already guards its reappearance.

Site 2, verbatim (`src/pages/api/proposals.ts:195-202`):

```ts
const { error: proposalsError } = await supabase.from("proposals").insert(
  proposals.map((p) => ({
    user_id: userId,
    spoonacular_id: p.id,
    requested_cuisine: p.requestedCuisine,
    requested_type: null,
  })),
);
```

#### The `recipes` schema — final, cumulative

Four migrations were read in order. **No migration after the first touches
`recipes`' columns.** Final state, `supabase/migrations/20260720181257_cold_start_proposals.sql:14-19`:

```sql
create table if not exists public.recipes (
  spoonacular_id bigint primary key,
  title text not null,
  image text,
  created_at timestamptz not null default now()
);
```

There is **no** `cuisine`, `dish_type`, `summary`, `description`, `source_name`,
`source_url`, `ready_in_minutes`, `servings`, `nutrition`, or JSONB/raw-payload
column anywhere in the schema. `created_at` is app-clock, not provider data.

The only schema evolution relevant here is on `proposals`:
`requested_cuisine` lost its `NOT NULL` at
`supabase/migrations/20260809120000_personalized_proposal_slots.sql:21`, because
slots 1/2 re-fetch by id and pin no cuisine. And
`supabase/migrations/20260809180000_manage_rated_recipes.sql:28-29` dropped the
`recipes` insert policy and revoked `insert` from `authenticated` — which is why
site 1 uses the admin client.

#### Provenance of `requested_cuisine` — answering the "must challenge"

`change.md` requires the test to challenge *"requested cuisine is a provider
recipe field"*. The trace refutes it at three independent points:

1. **Value origin.** `requested_cuisine` is `p.requestedCuisine`
   (`src/pages/api/proposals.ts:199`), set in `toProposed(recipes, requestedCuisine)`
   at `src/lib/proposals.ts:254-260` — from the *parameter the caller passes in*.
   The two callers pass `cuisineA`/`cuisineB`, the values handed to
   `searchRecipes` moments earlier (`src/lib/proposals.ts:306-328`).
2. **Structural impossibility of the alternative.** `toCandidate`
   (`src/lib/spoonacular.ts:54-72`) is a whitelist; `RecipeCandidate`
   (`src/lib/spoonacular.ts:6-14`) has no `cuisines` field. The response array
   cannot reach `requestedCuisine` even by accident.
3. **Recorded design intent.** The migration's own header comment
   (`supabase/migrations/20260720181257_cold_start_proposals.sql:10-12`) states:
   *"the cuisine the app pinned in its request. Never the response's `cuisines[]`."*

The by-id path corroborates it: `fromById` calls `toProposed(result.recipes, null)`
(`src/lib/proposals.ts:346`) — a re-fetch pinned no cuisine, so it records `NULL`
rather than reading one off the payload. **That NULL is itself evidence for the
test**: a `requested_cuisine` that were provider-derived would be populated on a
by-id row, since the by-id response carries `cuisines[]` too.

#### Provider payload → fate of each field

`RecipeCandidate` (`src/lib/spoonacular.ts:6-14`) is doc-commented *"Only the
fields a proposal card needs — nothing else leaves this module (PRD FR-011)"*.

| Provider field | Extracted? | Reaches DB? | Fate |
|---|---|---|---|
| `id` | yes | **yes** | permitted |
| `title` | yes | **yes** | permitted |
| `image` | yes | **yes** | permitted |
| `summary` | yes | no | sanitised into `excerpt`; render-only |
| `sourceName` | yes | no | render-only (FR-010 credit) |
| `sourceUrl` | yes | no | render-only |
| `spoonacularSourceUrl` | yes | no | render-only fallback |
| `cuisines[]`, `dishTypes[]`, nutrition, ingredients, instructions | **not parsed** | no | dropped at `toCandidate` |

`includeNutrition` / `addRecipeNutrition` are never sent — `searchRecipes` builds
only `addRecipeInformation`, `cuisine`, `number`, `offset`, `sort`
(`src/lib/spoonacular.ts:121-133`).

#### The regression vector: two spreads and an un-narrowed argument

`ProposedRecipe` is deliberately wide, built by spread:

- `src/lib/proposals.ts:255-259` — `{ ...recipe, requestedCuisine, excerpt }`
- `src/lib/proposals.ts:465` — `{ ...recipe, slot, asDesigned }` (`SlottedRecipe`)

Both are in-memory only, and today two explicit projections narrow before the
boundaries: `toPayload()` (`src/pages/api/proposals.ts:51-70`) for the wire, and
the upsert map (`:186`) for the DB.

The sharp edge: **`persist()` receives `ProposedRecipe[]`, not the narrowed
payload** (`src/pages/api/proposals.ts:147, 162-166`). So the wide object —
including `excerpt`, a *derived form of `summary`* that FR-011 explicitly
forbids — is in scope at the write site, and the only thing keeping it out of
the database is one hand-written object literal with no type-level enforcement.
This is precisely the anti-pattern `change.md` names ("snapshotting the whole
provider object and asserting it round-trips") inverted into a real risk.

No raw-payload persistence exists anywhere: `JSON.stringify` occurrences are all
HTTP bodies; no `localStorage`, `sessionStorage`, or KV writes.

#### What the existing tests do and do not cover

`src/pages/api/__tests__/proposals.test.ts:270-291` (`— persistence rows`)
asserts: `upsert` called once, its **options** equal `{ onConflict: "spoonacular_id" }`,
`insert` called once, and the proposals rows' `user_id` / `spoonacular_id` /
`requested_cuisine` *values*.

**The gap, precisely:**

- The recipes upsert's **first argument is never read**. `upsert.mock.calls[0][0]`
  is untouched — no key-set assertion, no value assertion, nothing. A `{ ...p }`
  regression is invisible to the entire current suite.
- The proposals insert asserts values per column but never asserts the key set is
  *closed* — an added `summary` column would pass.
- Nothing exercises `toCandidate` against a payload carrying `cuisines[]` /
  `dishTypes[]` / nutrition to prove the boundary drops them.

### Risk #5 — where cuisines are chosen and recorded

#### The pool and the selection

`src/lib/proposals.ts:4-7`:

```ts
/** The six cuisines the F-01 spike verified return full results. */
export const CUISINES = Object.freeze(["italian", "mexican", "chinese", "greek", "thai", "french"] as const);
export type Cuisine = (typeof CUISINES)[number];
```

`src/lib/proposals.ts:243-248`:

```ts
/** Two *distinct* cuisines; the modular step keeps them from ever colliding. */
export function pickCuisinePair(): [Cuisine, Cuisine] {
  const first = Math.floor(Math.random() * CUISINES.length);
  const step = 1 + Math.floor(Math.random() * (CUISINES.length - 1));
  return [CUISINES[first], CUISINES[(first + step) % CUISINES.length]];
}
```

`step ∈ [1,5]`, so `(first + step) % 6 !== first` — collisions are arithmetically
impossible. Both cold-start and personalized paths pick exactly 2.

Offset variety: `randomOffset()` (`src/lib/proposals.ts:250-252`) bounded by
`MAX_OFFSET = 20` (`:65`) — an **app-side measured bound**, far below the
provider's 900 clamp, because at offset 50 `chinese`/`greek`/`thai` return zero
results (measured 2026-07-20; see §Historical Context).

#### Cold start: pin, attach, count

`src/lib/proposals.ts:302-338`. Two concurrent pinned calls (`:306-309`), then
per-group tagging so each recipe carries *its own call's* cuisine (`:317-328`),
then interleave + `slice(0, SET_SIZE)` (`:330`), then:

```ts
// Coverage, not call success: a call can return 200 with zero results (a thin cuisine, or
// an offset past its corpus), which yields a single-cuisine set from two healthy calls.
// US-02's criterion is two cuisines in the *set*, so that is what `degraded` reports.
const cuisinesCovered = new Set(proposals.map((p) => p.requestedCuisine)).size;

return { ok: true, proposals, degraded: cuisinesCovered < 2 };
```

`src/lib/proposals.ts:332-337`. **This is the "≥2 cuisines" computation, and it
reads the request side.** It surfaces to the user at
`src/components/proposals/ProposalList.tsx:107` ("Only one cuisine was available
this time.").

`buildPersonalizedSet` computes no cuisine-coverage equivalent — its `degraded`
tracks slot-fill provenance instead. Defensible: US-02 binds cold start only.

#### Personalized: the same 2 pins, chosen differently

`src/pages/api/proposals.ts:113` decides the branch on **like** count, not total
ratings:

```ts
const mode: ProposalMode = recentLikes.length > 0 ? "personalized" : "cold_start";
```

A dislikes-only user routes to cold start — which is why `buildColdStartSet`
takes `excludeIds` (`src/lib/proposals.ts:299-302`). `src/lib/proposals.ts:374-388`
pins slot 3 to the affinity cuisine and slot 4 to a different one, with a guard
for `topCuisine === randomB` since `topCuisine` is an arbitrary DB string.

#### The recording surfaces — there are two

"Requested **and recorded**" (test-plan §2, #5) has two distinct landing places,
and a complete test should cover both:

1. **In-memory / wire** — `requestedCuisine` on `ProposedRecipe`
   (`src/lib/proposals.ts:13-16`, doc-commented *"the cuisine the app asked for —
   never the response's derived `cuisines[]`"*), out to the client at
   `src/pages/api/proposals.ts:42, 65`.
2. **Database** — `proposals.requested_cuisine`
   (`supabase/migrations/20260720181257_cold_start_proposals.sql:26`), written at
   `src/pages/api/proposals.ts:199`, and read back by the `cuisine_affinity` view
   (`supabase/migrations/20260809120000_personalized_proposal_slots.sql:48-61`),
   which filters `requested_cuisine is not null` so by-id events don't pollute
   affinity counts. Consumed at `src/lib/history.ts:171-185`.

Surface 2 closes the loop: **the app's own request data drives the taste
profile**. That is what makes the FR-011 argument load-bearing rather than
academic — this column is not incidental, the recommendation engine depends on it.

#### Reads of the response's `cuisines[]`: zero

A repo-wide search for `cuisines` / `dishTypes` / `diets` / `occasions` in `src/`
returns only comments and test names. Confirmed structurally at
`src/lib/spoonacular.ts:54-72`.

#### What the existing tests do and do not cover

`src/lib/__tests__/proposals.test.ts:68-93` loops 30× and asserts per-call
`number`, `sort`, `offset` bounds, `expect(CUISINES).toContain(params.cuisine)`
(`:87` — the mirror-test flaw), and `calls[0][0].cuisine !== calls[1][0].cuisine`
(`:91`). `:107-119` covers degradation when **one call fails** (HTTP 502).

**The gap, precisely:**

- No assertion that the **delivered set** spans ≥2 distinct `requestedCuisine`
  values. Only the *requests* are checked.
- The **200-with-zero-results** collapse — the documented thin-cuisine failure
  mode — is untested. Only the failed-call variant is.
- Nothing proves `degraded` is computed from the request side rather than the
  response. Today it is; a refactor to read a response field would stay green.
- Nothing feeds a raw payload with a populated, *contradictory* `cuisines[]`
  through `toCandidate` to prove it is ignored. This is the inversion of the
  anti-pattern `change.md` names, and it is the only way to actually challenge
  *"the response says 2 cuisines, so we're fine."*
- `:87` imports `CUISINES` from the implementation — must not be copied.

### Recommended anchors (research's answer to "where the failure lives")

The test plan's Risk Response Guidance guesses "unit / integration" for #4 and
"unit" for #5. Both are right; the *locations* it does not name are:

| Assertion | File | Layer |
|---|---|---|
| Recipes upsert row key set is exactly `{spoonacular_id, title, image}` | `src/pages/api/__tests__/proposals.test.ts` | endpoint unit |
| Proposals insert row key set is exactly the four app-owned columns | `src/pages/api/__tests__/proposals.test.ts` | endpoint unit |
| `requested_cuisine` provenance: equals the pinned param; `NULL` on by-id rows | `src/pages/api/__tests__/proposals.test.ts` | endpoint unit |
| Persisted rows span ≥2 distinct `requested_cuisine` on a cold-start set | `src/pages/api/__tests__/proposals.test.ts` | endpoint unit |
| `toCandidate` drops `cuisines[]`/`dishTypes[]`/nutrition from a dirty payload | `src/lib/__tests__/spoonacular.test.ts` | edge unit |
| Delivered cold-start set spans ≥2 distinct `requestedCuisine` | `src/lib/__tests__/proposals.test.ts` | engine unit |
| 200-with-zero-results collapses to one cuisine **and** raises `degraded` | `src/lib/__tests__/proposals.test.ts` | engine unit |
| Diversity survives a populated-but-contradictory response `cuisines[]` | `src/lib/__tests__/proposals.test.ts` | engine unit |

Two notes the plan should absorb:

- **Make the fixture deliberately dirty.** The existing `candidate()` factory
  (`src/lib/__tests__/proposals.test.ts:32-43`) and `proposed()`
  (`src/pages/api/__tests__/proposals.test.ts:52-…`) build clean objects. For #4,
  the fixture must carry `summary`, `excerpt`, `sourceUrl`, `sourceName`,
  `spoonacularSourceUrl` *and* an extra `cuisines: ["thai"]` / `dishTypes: [...]`
  — then assert the written key set is exactly the allow-list. A clean fixture
  cannot fail, which is how a storage test passes while the leak ships.
- **Assert key sets, not key absence.** `expect(row.summary).toBeUndefined()` is
  an enumeration and will not catch the next field the provider adds.
  `expect(Object.keys(row).sort()).toEqual([...])` is closed.

## Code References

- `src/pages/api/proposals.ts:185-188` — the only provider-derived write; explicit key selection
- `src/pages/api/proposals.ts:195-202` — proposals insert; `requested_cuisine` written here
- `src/pages/api/proposals.ts:147, 162-166` — `persist()` receives the *wide* `ProposedRecipe[]`
- `src/pages/api/proposals.ts:171-175` — repairing-upsert rationale (lesson-2 hardening)
- `src/pages/api/proposals.ts:113` — cold-start vs personalized branch predicate (like count)
- `src/pages/api/proposals.ts:51-70` — `toPayload()`, the wire-shape projection
- `src/lib/proposals.ts:4-7` — `CUISINES`, the frozen six-value pool
- `src/lib/proposals.ts:243-248` — `pickCuisinePair()`, distinct by modular construction
- `src/lib/proposals.ts:254-260` — `toProposed()`, attaches the pinned cuisine per group
- `src/lib/proposals.ts:302-338` — `buildColdStartSet()`; `:335` is the ≥2-cuisine computation
- `src/lib/proposals.ts:346` — `fromById` records `null` cuisine on by-id re-fetches
- `src/lib/proposals.ts:374-388` — personalized slot-3/4 cuisine pinning with distinctness guard
- `src/lib/spoonacular.ts:6-14` — `RecipeCandidate`, the FR-011 whitelist type
- `src/lib/spoonacular.ts:54-72` — `toCandidate()`, where `cuisines[]` is dropped
- `supabase/migrations/20260720181257_cold_start_proposals.sql:14-19` — final `recipes` schema
- `supabase/migrations/20260720181257_cold_start_proposals.sql:10-12, 25-26` — request-side cuisine intent
- `supabase/migrations/20260809120000_personalized_proposal_slots.sql:21` — `requested_cuisine` made nullable
- `supabase/migrations/20260809120000_personalized_proposal_slots.sql:48-61` — `cuisine_affinity` view
- `supabase/migrations/20260809180000_manage_rated_recipes.sql:28-29` — `recipes` insert revoked
- `src/pages/api/__tests__/proposals.test.ts:270-291` — existing persistence tests (and the gap)
- `src/pages/api/__tests__/proposals.test.ts:97-108` — dual-client mock builder to reuse
- `src/lib/__tests__/proposals.test.ts:68-93` — existing request-side diversity loop; `:87` mirror flaw
- `src/lib/__tests__/proposals.test.ts:19-30` — the oracle-constants convention, stated in-file
- `src/lib/__tests__/history.test.ts:6-26` — chainable Supabase fake-client idiom
- `vitest.config.ts:1-24` — node env, `@/` alias, `astro:env/server` stub wiring

## Architecture Insights

**FR-011 is enforced by projection, not by type.** Three narrowing points carry
the whole compliance burden — `toCandidate` at the HTTP edge, `toPayload` at the
wire, and the upsert map at the DB. All three are hand-written object literals.
The type system permits a spread at any of them. A `Pick<ProposedRecipe, "id" |
"title" | "image">`-typed row helper would make the discipline structural rather
than conventional; that is an implementation suggestion, not test scope, but it
is the durable fix behind the test.

**The two-tier defence against provider data is real and worth preserving.**
Forbidden fields (`cuisines[]`, nutrition, ingredients) are dropped at the *edge*
and never enter the app's object graph at all. Permitted-but-unstorable fields
(`summary`, `sourceUrl`) are carried in memory and dropped at the *DB boundary*.
Tests should assert both tiers, because they fail differently: tier 1 fails by a
type gaining a field, tier 2 by a literal gaining a spread.

**The oracle rule** (test-plan §6.1, and stated in-file at
`src/lib/__tests__/proposals.test.ts:19-30`): assert PRD/research constants
hard-coded, never imported from the implementation — *"what keeps this from
becoming a mirror test that passes against a regression."* For this slice the
oracles are the FR-011 triple `["image","spoonacular_id","title"]`, the four
app-owned proposals columns, US-02's `2`, and the cuisine allow-list
`["italian","mexican","chinese","greek","thai","french"]` written out literally.

**Harness facts the plan needs** (full detail in the runner config):
`vitest.config.ts` runs `environment: "node"`, includes only
`src/**/__tests__/**/*.test.ts`, hand-wires the `@/` alias and an
`astro:env/server` stub (`test/stubs/astro-env-server.ts`) because the Cloudflare
adapter's Vite plugin rejects `getViteConfig()`'s SSR externals. Vitest 4.1.10;
**no globals** — import `describe`/`it`/`expect`/`vi` explicitly. No jsdom, no
testing-library, no MSW. Suite today: 6 files, 66 tests, ~4.2s, green.
`--reporter=basic` is invalid on Vitest 4.

**The stub exports only `SPOONACULAR_API_KEY`.** Anything importing
`@/lib/supabase` or `@/lib/supabase-admin` must be module-mocked
(`vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }))`) rather than
having the stub extended — the convention is stated at
`src/pages/api/__tests__/ratings.test.ts:4-6`. `src/lib/history.ts` sidesteps it
via dependency injection (client passed as an argument), which is why
`history.test.ts` needs no module mock.

**No shared test-helper module exists**, and duplication across files is the
accepted convention (`USER_ID` is redeclared three times). Follow it; do not
introduce a shared helper for a test-only slice.

## Historical Context (from prior changes)

- `context/archive/2026-07-20-cold-start-proposals/plan.md:84-102` — the original
  storage decision: *"**Exactly** the three fields the provider's terms permit
  storing indefinitely: id, title, image. **Prohibited columns** (FR-011,
  including derived or transformed copies): `summary`, `cuisines`, `dish_types`,
  ingredients, instructions, nutrition."* And: *"A reviewer should be able to
  read this migration and see that only the three permitted provider fields are
  present."* — the test is the automated form of that reviewer.
- `context/archive/2026-07-20-cold-start-proposals/plan.md:163-165` — the measured
  thin-cuisine finding: *"Measured 2026-07-20 across all six cuisines: at offset
  50 `chinese`, `greek`, and `thai` return zero results, which silently yields a
  single-cuisine set while still spending both quota points. All six return
  results at offset 20."* This is the empirical basis for `MAX_OFFSET = 20` and
  for the untested 200-with-zero-results case.
- `context/archive/2026-07-20-cold-start-proposals/plan.md:191-193` — *"keeping the
  request-side cuisine attached to each candidate — because the response's
  `cuisines[]` is derived, often empty, and must never be persisted."*
- `context/archive/2026-08-08-personalized-proposal-slots/research.md:28-29` — *"the
  taste profile must be inferred from cuisines the app requested and recorded,
  never from the provider-returned `cuisines[]` array."* `requested_cuisine` was
  never debated or rejected; it was designed this way from S-02 onward.
- `context/archive/2026-07-16-spoonacular-retrieval-spike/findings.md:15-37` — the
  cost formula `1 + 0.035n` confirmed exactly against measurement; cold start 3.40
  pts, steady state 5.40 pts.
- `context/changes/testing-harness-proposal-units/change.md:15-16, 25` — the
  predecessor slice **explicitly deferred #4 and #5**: *"This research pass scopes
  risk #1 only. Risks #4 and #5 get their own research when their sub-phases
  open."*
- `context/changes/testing-harness-proposal-units/plan.md:70-71` — established the
  oracle-from-PRD discipline this slice inherits.
- `context/changes/testing-harness-proposal-units/research.md:249-257` — recorded
  anti-patterns, including: *"A global 'never calls `getRecipeById`' assertion —
  true today, but it encodes a claim that S-05 will legitimately break."* The
  analogue here: **do not write a global "no cuisine field is ever persisted"
  assertion**; `proposals.requested_cuisine` is legitimate and permanent.
- `context/foundation/lessons.md:12-17` — the `recipes` shared-catalogue lesson,
  whose write-half was closed by `20260809180000` (insert revoked, service-role
  writes). The read-half remains open — see Q4.

## Related Research

- `context/changes/testing-harness-proposal-units/research.md` — risk #1 (quota /
  call count). Shares the `buildColdStartSet` call path with #5; its call-count
  assertions and this slice's diversity assertions inspect the same
  `search.mock.calls`.
- `context/archive/2026-07-20-cold-start-proposals/plan.md` — the schema and
  request-side-diversity design being tested.
- `context/archive/2026-08-08-personalized-proposal-slots/research.md` — the
  affinity loop that consumes `requested_cuisine`.

## Open Questions

**Q1 — Does the slice assert the migration's column set, or only the write site?**
The test-plan's #4 row says *"the exact column set the migration writes"*, but the
node-env unit runner has no database. A unit test *could* read
`supabase/migrations/*.sql` from disk with `node:fs` and regex the `recipes`
column list. Recommendation: **treat it as optional defence-in-depth, not
required.** A schema column alone persists nothing — the write site is the
necessary condition for a breach, and SQL regex parsing is brittle enough to
generate false reds on formatting changes. If the plan wants capability-level
coverage, Phase 3's integration tier against a local Supabase is the honest
place. Decision belongs to `/10x-plan`.

**Q2 — Should the FR-011 allow-list live in one place or be repeated per test?**
The oracle rule forbids importing the implementation's constant, but repeating
`["image","spoonacular_id","title"]` across two files invites drift in the
*test*. Recommendation: declare it once per test file as a local `const` with a
comment citing PRD FR-011 — matching the existing per-file duplication convention
rather than introducing a shared helper.

**Q3 — Fix `src/lib/__tests__/proposals.test.ts:87` in this slice, or leave it?**
`expect(CUISINES).toContain(params.cuisine)` is a mirror test in a file this
slice will edit anyway. It is risk #1's test, not #4/#5's, so fixing it is
technically out of scope — but the #5 work sits three lines away and will
otherwise sit next to a known-weak assertion. Recommendation: fix it (replace
with a hard-coded allow-list), and note it in the plan as an in-scope drive-by
rather than silent drift.

**Q4 — Not this slice, but surfaced:** `recipes` is world-readable to any
authenticated user (`using (true)`,
`supabase/migrations/20260720181257_cold_start_proposals.sql:47-49`). The
lesson-2 hardening closed the write half only. This is risk #7 / Phase 3
territory and is recorded here so it is not re-discovered as new.
