# Storage-Field Discipline (#4) + Request-Side Cuisine Diversity (#5) Implementation Plan

## Overview

Close the second and final slice of test-rollout **Phase 1** (`context/foundation/test-plan.md` §3).
Risk #1 shipped as `context/changes/testing-harness-proposal-units/`; this change converts
risks **#4** and **#5** into automated regression gates at the unit layer.

- **Risk #4** — the app persists a recipe field beyond `id`/`title`/`image` (or the
  response's `cuisines[]`/`dishTypes[]`), breaching Spoonacular's storage terms. On a
  provider dispute that forces deletion of *everything* obtained from the API.
- **Risk #5** — cold-start proposals deliver fewer than 2 cuisines because diversity is
  read from the response's often-empty `cuisines[]` instead of the pinned request-side
  cuisine (US-02 acceptance criterion).

Research (`research.md`) established that **neither risk is currently realised** — both are
correctly implemented, and both are one small edit away from silent breach. That is exactly
the shape a regression test is for: these tests pin the **invariant**, they do not certify
today's behaviour.

## Assumptions stated (non-interactive session)

No clarifying questions were asked. Six decisions were made here rather than deferred; each
is stated so a reviewer can overrule it explicitly.

- **A1 — Unit layer only.** `change.md` fixes the layer as `unit`; `vitest.config.ts` runs
  `environment: "node"` with no database. Real RLS behaviour and real FK enforcement stay in
  rollout Phase 3. Inherited from research A1.
- **A2 — Extend the three existing test files; create none.** The repo has no shared
  test-helper module and every test file builds its own fixtures (`USER_ID` is redeclared
  three times). Both risks land as new `describe` blocks in the files that already own the
  relevant surfaces. Inherited from research A2.
- **A3 — No migration-SQL assertion** (research Q1, resolved). A unit test *could* read
  `supabase/migrations/*.sql` with `node:fs` and regex the `recipes` column list, but a
  column that exists persists nothing — the **write site** is the necessary condition for a
  breach, and SQL regex parsing false-reds on formatting changes. Capability-level schema
  coverage belongs to rollout Phase 3 against a local Supabase. Recorded under
  §What We're NOT Doing.
- **A4 — The FR-011 allow-list is a per-file local `const`** (research Q2, resolved), each
  with a comment citing its PRD line. Repeating it across two files invites drift *in the
  test*, but a shared helper would break the repo's stated convention for a test-only slice
  and would re-create the mirror-test coupling the oracle rule forbids. Duplication with a
  citation is the lesser cost.
- **A5 — The `CUISINES` mirror test is fixed in this slice** (research Q3, resolved), and is
  declared in-scope rather than silent drift. Rationale below in §Key Discoveries — the fix
  closes a mirror test that passes against a wholesale pool replacement, which the imported
  constant cannot catch. It is drift protection on the risk-#5 surface, not a zero-results
  gate (that is `MAX_OFFSET`), and it is not tidying.
- **A6 — No production code changes.** This is a test-only slice. Research's suggestion of a
  `Pick<ProposedRecipe, "id" | "title" | "image">`-typed row helper (which would make FR-011
  structural rather than conventional) is the durable fix, but changing production code in
  the same commit as the test that guards it destroys the mutation checks that prove the
  test works. Recorded under §What We're NOT Doing as the natural follow-on.

## Current State Analysis

**The write path (risk #4).** Exactly three DB writes exist in `src/`; only one carries
provider-derived recipe content beyond the id:

| # | Site | Table | Client | Columns written |
|---|------|-------|--------|-----------------|
| 1 | `src/pages/api/proposals.ts:185-188` | `recipes` | **service-role** (`createAdminClient()`) | `spoonacular_id`, `title`, `image` |
| 2 | `src/pages/api/proposals.ts:195-202` | `proposals` | anon session | `user_id`, `spoonacular_id`, `requested_cuisine`, `requested_type` |
| 3 | `src/pages/api/ratings.ts:101-109` | `ratings` | anon session | `user_id`, `spoonacular_id`, `verdict`, `rated_at` |

Site 1's row object is built by **explicit key selection** from a `ProposedRecipe` that also
carries `summary`, `excerpt`, `sourceName`, `sourceUrl`, `spoonacularSourceUrl`,
`requestedCuisine`, `slot`, `asDesigned`. The `recipes` table has four columns total and has
not changed across any of the four migrations
(`supabase/migrations/20260720181257_cold_start_proposals.sql:14-19`).

**The regression vector is one character wide.** `persist()` receives the *wide*
`ProposedRecipe[]`, not the narrowed wire payload (`src/pages/api/proposals.ts:147,162-166`).
Changing the upsert's map callback from `{ spoonacular_id: p.id, title: p.title, image: p.image }`
to `{ ...p }` would ship `summary` **and `excerpt`** — a derived form of `summary`, which
FR-011 forbids "in any derived form" — straight into a write. Nothing in the type system
stops it, and **the current suite never reads `upsert.mock.calls[0][0]` at all**
(`src/pages/api/__tests__/proposals.test.ts:280-291` asserts only the `onConflict` *options*
argument and the `proposals` row values).

**The diversity path (risk #5).** `pickCuisinePair()` (`src/lib/proposals.ts:243-248`)
returns two cuisines distinct by modular construction; both are pinned as `cuisine` params;
each candidate is tagged with the cuisine *its own call* requested via
`toProposed(recipes, requestedCuisine)` (`:254-260`). The response's `cuisines[]` is not
merely unused — it is **structurally unreachable**: `toCandidate`
(`src/lib/spoonacular.ts:54-72`) is a whitelist projection of seven fields and
`RecipeCandidate` has no `cuisines` member. The ≥2 computation reads the request side
(`src/lib/proposals.ts:335`) and surfaces at `ProposalList.tsx:107`.

**The residual #5 exposure is not request-vs-response.** It is that the request-side
guarantee (2 distinct cuisines *pinned*) does not imply the delivered-set guarantee (≥2
distinct cuisines in the 4 cards). A cuisine returning HTTP 200 with **zero results** — the
measured behaviour of `chinese`/`greek`/`thai` past offset 20
(`context/archive/2026-07-20-cold-start-proposals/plan.md:163-165`) — collapses the set to
one cuisine from two *healthy* calls. Only the **failed-call** variant is tested today
(`src/lib/__tests__/proposals.test.ts:107-119`).

**Harness facts.** Vitest 4.1.10, `environment: "node"`, includes only
`src/**/__tests__/**/*.test.ts`, **no globals** (import `describe`/`it`/`expect`/`vi`
explicitly). `vitest.config.ts` hand-wires the `@/` alias and an `astro:env/server` stub
because the Cloudflare adapter's Vite plugin rejects `getViteConfig()`'s SSR externals. The
stub exports only `SPOONACULAR_API_KEY`; anything importing `@/lib/supabase` or
`@/lib/supabase-admin` must be module-mocked. Suite today: 6 files, 66 tests, ~4.2 s, green.
`--reporter=basic` is invalid on Vitest 4.

## Desired End State

`npm test` fails the moment a change:

1. spreads the provider object (or adds any field) into the `recipes` upsert row — **#4**;
2. adds any column beyond the four app-owned ones to the `proposals` insert row — **#4**;
3. sources `requested_cuisine` from anything other than the pinned request param — **#4**;
4. widens `toCandidate` to admit `cuisines[]`/`dishTypes[]`/nutrition at the HTTP edge — **#4**;
5. delivers a cold-start set spanning fewer than 2 distinct *requested* cuisines without
   flagging `degraded` — **#5**;
6. computes `degraded` from the response body instead of the request side — **#5**;
7. pins a cuisine outside the six the F-01 spike verified — **#5**.

Verify by running `npm test` (green), then executing the mutation checks in each phase's
Manual Verification and confirming each goes **red** before restoring.

### Key Discoveries

- **Two tiers of defence, and they fail differently** (`research.md` §Architecture Insights).
  *Tier 1* — forbidden fields (`cuisines[]`, nutrition, ingredients, instructions) are
  dropped at the **HTTP edge** and never enter the app's object graph; it fails by a type
  gaining a field. *Tier 2* — permitted-but-unstorable fields (`summary`, `sourceUrl`,
  `excerpt`) are carried in memory and dropped at the **DB boundary**; it fails by a literal
  gaining a spread. Both must be asserted; neither implies the other.
- **`requested_cuisine` is the app's own request data, not a provider field** — the
  "must challenge" in test-plan §2. Refuted at three independent points: the value origin is
  the parameter the caller passes (`src/lib/proposals.ts:254-260`); the alternative is
  structurally impossible (`RecipeCandidate` has no `cuisines`); and the migration's own
  header comment says so (`20260720181257_cold_start_proposals.sql:10-12`). The by-id path
  corroborates it — `fromById` calls `toProposed(result.recipes, null)`
  (`src/lib/proposals.ts:346`), so a by-id row records **NULL** even though the by-id
  response also carries `cuisines[]`. **That NULL is the sharpest evidence — but only when
  asserted at the engine layer.** The endpoint test module-mocks `@/lib/proposals`
  (`src/pages/api/__tests__/proposals.test.ts:16-19`) and its fixture supplies
  `requestedCuisine: null` directly, so it can only show the endpoint does not *invent* a
  cuisine; it cannot observe `fromById` at all. The provenance proof therefore lives in
  Phase 2 change #6, against a **dirty by-id candidate** — `candidate()` (`:32-43`) carries no
  `cuisines` key, so the existing `toBeNull()` at `:252` is another clean fixture that cannot
  fail.
- **`requested_cuisine` is load-bearing, not incidental.** The `cuisine_affinity` view
  (`20260809120000_personalized_proposal_slots.sql:48-61`) filters
  `requested_cuisine is not null` and drives slot 3's taste profile via
  `src/lib/history.ts:171-185`. The app's *own request data* powers the recommendation
  engine — which is what makes the FR-011 argument structural rather than academic.
- **Assert closed key sets, never key absence.** `expect(row.summary).toBeUndefined()` is an
  enumeration and will not catch the next field the provider adds.
  `expect(Object.keys(row).sort()).toEqual([...])` is closed. This is the single most
  important assertion shape in the slice.
- **Fixtures must be deliberately dirty.** The existing `candidate()`
  (`src/lib/__tests__/proposals.test.ts:32-43`) and `proposed()`
  (`src/pages/api/__tests__/proposals.test.ts:52-64`) factories build clean objects. **A clean
  fixture cannot fail** — which is how a storage test passes green while the leak ships.
- **The `CUISINES` mirror test has a risk-#5 payload** (A5). `expect(CUISINES).toContain(params.cuisine)`
  (`src/lib/__tests__/proposals.test.ts:87` and `:205`) asserts membership in *whatever
  `CUISINES` currently is* — replacing the pool wholesale keeps it green. The hard-coded
  allow-list pins the **six measured cuisines**
  (`context/archive/2026-07-20-cold-start-proposals/plan.md:162-164`), so a wholesale swap to
  unmeasured cuisines cannot ship silently. What the list does **not** buy is protection from
  the 200-with-zero-results collapse: that same measurement records `chinese`, `greek`, and
  `thai` returning zero results at offset 50, so three of the six are thin at depth. The
  zero-results guard is `MAX_OFFSET = 20`, already pinned by `OFFSET_MAX` (`:85-86`). Both call
  sites must change, which makes the `CUISINES` import at `:13` unused — remove it or lint fails.
- **Do not write a global "no cuisine field is ever persisted" assertion.** The predecessor
  slice recorded this class of anti-pattern
  (`context/changes/testing-harness-proposal-units/research.md:249-257`):
  `proposals.requested_cuisine` is legitimate and permanent.

## What We're NOT Doing

- **Migration-SQL column assertion** (A3). Deferred to rollout Phase 3's integration tier
  against a local Supabase, where a schema claim can be verified by the database rather than
  by regex.
- **Any production code change**, including the `Pick<ProposedRecipe, "id" | "title" | "image">`
  row-helper that would make FR-011 structural (A6). It is the right follow-on and should be
  its own change — the tests written here are what make it safe to do.
- **Risk #7** (`recipes` is world-readable to any authenticated user via `using (true)`,
  `20260720181257_cold_start_proposals.sql:47-49`). Surfaced by research Q4; the lesson-2
  hardening closed only the write half. Rollout Phase 3 territory, recorded so it is not
  re-discovered as new.
- **A key-set assertion on the wire projection.** `toPayload` (`src/pages/api/proposals.ts:57-69`)
  is the third hand-written narrowing literal beside `toCandidate` and the upsert map, and it is
  the one carrying the "sanitized excerpt only — the raw HTML `summary` never crosses to the
  client" burden (`:28-31`). Nothing asserts its key set: the hydration test (`:243-267`) uses
  `toMatchObject`, which is open, so a `summary: recipe.summary` added to `toPayload` would ship
  raw provider HTML **and inline macro figures** to the client with the suite green. That is a
  render/wire concern — risk #6, rollout Phase 2 — not a storage-write one, and the wire contract
  legitimately gains fields over time in a way FR-011's licence-fixed triple does not. Recorded
  here so it is not re-discovered as an oversight.
- **Integration / component / e2e layers, MSW, jsdom** — rollout Phases 2–4 (test-plan §4).
- **CI gate wiring** — rollout Phase 4, per the CLAUDE.md lesson boundary.
- **Any quota-spending test.** Every provider call is stubbed; the suite spends zero
  Spoonacular points.
- **Seeding `Math.random`.** Invariants that hold across all seeds, looped ~30× — the
  convention established by the risk-#1 slice.
- **`src/pages/api/ratings.ts` write site.** It persists no provider-derived recipe content
  (`user_id`, `spoonacular_id`, `verdict`, `rated_at`), so it carries no #4 exposure. Its
  isolation properties are risk #2, rollout Phase 3.

## Implementation Approach

Three interception layers, each already proven in this repo, matched to the tier they can
actually observe:

1. **DB boundary (tier 2, endpoint unit)** — `src/pages/api/__tests__/proposals.test.ts`.
   The endpoint's collaborators are module-mocked, so the test supplies the `ProposedRecipe[]`
   that reaches `persist()` and reads the **exact row objects** handed to
   `upsert`/`insert` via `mock.calls[0][0]`. This is the only seam that sees the row literal.
2. **HTTP edge (tier 1, edge unit)** — `src/lib/__tests__/spoonacular.test.ts`. Stub global
   `fetch` with a **dirty raw body** and assert the projected `RecipeCandidate` key set. Here
   `searchRecipes`/`getRecipeById` are the units under test, so reading their `fetch` output
   is not the "mock an internal collaborator" anti-pattern.
3. **Engine (diversity, engine unit)** — `src/lib/__tests__/proposals.test.ts`. `@/lib/spoonacular`
   is module-mocked, so the test controls what each pinned call returns and asserts the
   **delivered set's** `requestedCuisine` distribution and the `degraded` flag.

The oracle rule (test-plan §6.1) governs throughout: assert PRD/research constants hard-coded,
never imported from the implementation.

### Oracle constants for this slice

Each is written as a literal in the test file, with a comment citing its source.

| Constant | Value | Source |
|---|---|---|
| `recipes` permitted columns | `["image", "spoonacular_id", "title"]` | PRD FR-011 ("only a recipe's Spoonacular id, title, and image URL") |
| `proposals` app-owned columns | `["requested_cuisine", "requested_type", "spoonacular_id", "user_id"]` | test-plan §2 #4 ("the app's own request facets"); migration `20260720181257:22-30` |
| `RecipeCandidate` in-memory whitelist | `["id", "image", "sourceName", "sourceUrl", "spoonacularSourceUrl", "summary", "title"]` | FR-011 (three storable) + FR-010 (`sourceName`/`sourceUrl` credit) + NFR (`spoonacularSourceUrl` fallback, `summary`→excerpt) |
| Cuisine minimum | `2` | PRD US-02 acceptance ("span at least 2 different cuisine types") |
| Verified cuisine corpus | `["italian", "mexican", "chinese", "greek", "thai", "french"]` | `context/archive/2026-07-20-cold-start-proposals/plan.md:162-164` (the six measured), corroborated by F-01 spike `findings.md:56` |

All three key-set literals above are **already in JS default-sort order**, so they compare
directly against `Object.keys(row).sort()`. (JS sorts by UTF-16 code unit — `"requested_cuisine"`
before `"requested_type"`, `"sourceName"` before `"sourceUrl"` before `"spoonacularSourceUrl"`.)

## Critical Implementation Details

**Building a dirty fixture without fighting TypeScript.** The excess-property check fires on
object literals in a typed position, and `strictTypeChecked` will flag a redundant `as`
assertion. Returning a *variable* whose type is wider than the declared return type is
allowed and lint-clean — this is the idiom to use in both dirty factories:

```ts
function dirtyProposed(id: number, requestedCuisine: string | null): ProposedRecipe {
  // Wider than ProposedRecipe on purpose: `cuisines`/`dishTypes`/`nutrition` are the
  // forbidden provider fields, `summary`/`excerpt` the permitted-in-memory-only ones.
  // Assigned to a variable first — an object literal in the return position would trip
  // the excess-property check, and an `as` cast would trip no-unnecessary-type-assertion.
  const wide = {
    ...proposed(id, requestedCuisine),
    summary: "<b>Chicken Tikka</b> has 452 calories and 23g of protein. <a href='https://spoonacular.com'>See more</a>",
    excerpt: "Chicken Tikka",
    cuisines: ["thai"],
    dishTypes: ["main course", "dinner"],
    nutrition: { calories: 452 },
  };
  return wide;
}
```

If this pattern is rejected by a future lint rule, the fallback is a
`Record<string, unknown>`-typed fixture plus a single `as unknown as ProposedRecipe` at the
call site — but try the variable form first.

**The contradictory-cuisine sentinel must not be a real cuisine.** The engine test asserts no
delivered proposal carries a response-derived cuisine. If the fixture used `"thai"` (a member
of the pool), a run that legitimately pins `thai` would false-red at ~1-in-3. Use a value
that cannot be pinned — e.g. `"provider-derived"` — and additionally assert the delivered
`requestedCuisine` set equals the set of cuisines **read back from `search.mock.calls`**.
Deriving the expected value from observed call args rather than a constant is the strongest
available oracle here, and it cannot mirror the implementation.

**Preserve the existing mock-counter idiom when looping.** `src/lib/__tests__/proposals.test.ts:60-66`
closes over `let call = 0` and the loop body calls `search.mockClear()` (**not** `mockReset()`),
so the counter keeps advancing and each call receives a disjoint id range. New looped tests
must follow this — a `mockReset()` inside the loop would reinstall a counter at 0 and make
both pinned calls return identical ids, which dedupe would then collapse into a
single-cuisine set and produce a spurious red.

**`degraded` on an empty set is `true` by construction.** `new Set([]).size` is `0 < 2`, so a
double-zero-results (but 200-OK) pair reports `degraded: true` with an empty proposal list —
correct behaviour, and worth an assertion so a future "only flag when non-empty" refactor is
caught.

---

## Phase 1: Risk #4 — Storage-Field Discipline (Both Tiers)

### Overview

Prove that the only recipe fields reaching the database are `id`, `title`, `image` plus the
app's own request facets, and that forbidden provider fields are dropped at the HTTP edge
before they can ever enter the object graph. Every fixture in this phase is deliberately
dirty; a clean fixture cannot fail.

### Changes Required

#### 1. Dirty fixture + FR-011 oracle constants

**File**: `src/pages/api/__tests__/proposals.test.ts`

**Intent**: Give the endpoint tests a `ProposedRecipe` that carries every field FR-011
forbids — the permitted-in-memory ones (`summary`, `excerpt`) *and* the never-parsed provider
ones (`cuisines`, `dishTypes`, `nutrition`) — so the key-set assertions below have something
real to fail against.

**Contract**: A `dirtyProposed(id, requestedCuisine)` factory built on the existing
`proposed()`, plus a `dirtySlotted()` wrapper mirroring `slotted()`, and a `dirtyFullSet()`
mirroring `fullSet()`'s *shape* but **not** its pins: slots 1/2 `requestedCuisine: null`,
slot 3 pinned `"italian"`, slot 4 pinned `"french"` — deliberately **not** `"thai"`, which
`fullSet()` (`:113-115`) uses at slot 3 and which is the value every dirty recipe's `cuisines[]`
carries (see change #4's "never `"thai"`" assertion). Both pins are inside
`VERIFIED_CUISINES`. Two local
`const` oracles with comments citing PRD FR-011 and test-plan §2 #4 respectively:
`FR011_RECIPE_COLUMNS = ["image", "spoonacular_id", "title"]` and
`PROPOSALS_APP_COLUMNS = ["requested_cuisine", "requested_type", "spoonacular_id", "user_id"]`.
See §Critical Implementation Details for the TypeScript idiom the factory must use.

#### 2. `recipes` upsert row key set is closed

**File**: `src/pages/api/__tests__/proposals.test.ts`

**Intent**: Pin the FR-011 storage triple at the only write site that carries
provider-derived content, closing the gap where `upsert.mock.calls[0][0]` is currently never
read at all.

**Contract**: A new `describe` block. Drives the endpoint with `dirtyFullSet()` through the
mocked `buildPersonalizedSet`, then asserts for **every** row in `upsert.mock.calls[0][0]`
that `Object.keys(row).sort()` equals `FR011_RECIPE_COLUMNS` — a closed set, never
`toBeUndefined()` per-field. Also asserts the row *values* map correctly (`spoonacular_id`
from `p.id`, `title`, `image`) and that `adminFrom` was called with `"recipes"` — pinning
that the catalogue write travels on the service-role client (lesson-2 hardening). Does **not**
re-assert the `onConflict` option, which `:283` already owns.

#### 3. `proposals` insert row key set is closed

**File**: `src/pages/api/__tests__/proposals.test.ts`

**Intent**: The existing test at `:286-290` asserts values per column but never asserts the
key set is *closed* — an added `summary` column would pass today.

**Contract**: In the same new `describe`, assert every row of `insert.mock.calls[0][0]` has
`Object.keys(row).sort()` equal to `PROPOSALS_APP_COLUMNS`, and that `from` was called with
`"proposals"` on the session client. Complements rather than replaces the existing
value-level assertions.

#### 4. `requested_cuisine` provenance — the "must challenge" test

**File**: `src/pages/api/__tests__/proposals.test.ts`

**Intent**: The **endpoint-carriage** half of refuting *"requested cuisine is a provider recipe
field"* — the endpoint does not *invent* a cuisine. The fixture's `cuisines: ["thai"]`
**contradicts** its pinned `requestedCuisine`, so an endpoint that sourced the column from the
response body would be visibly wrong rather than coincidentally right. This layer cannot prove
more than that: `@/lib/proposals` is module-mocked here (`:16-19`), so `fromById` is
unobservable and the fixture itself supplies the `null`. The **engine-side** provenance proof —
that `fromById` passes `null` even though the by-id response carries `cuisines[]` — is Phase 2
change #6.

**Contract**: Fixture pins slots 3/4 to cuisines that are *not* `"thai"` while every recipe
carries `cuisines: ["thai"]`. Asserts the written `requested_cuisine` equals the pinned value
per row and is never `"thai"`; and that by-id slots 1/2 — whose `requestedCuisine` is `null`
though their fixture still carries `cuisines: ["thai"]` — write **`null`** rather than being
back-filled from the fixture's `cuisines[]`.

#### 5. `toCandidate` drops forbidden fields at the HTTP edge (tier 1)

**File**: `src/lib/__tests__/spoonacular.test.ts`

**Intent**: Prove the edge whitelist, which is a *different* failure mode from the DB
boundary — it fails by a type gaining a field, not by a literal gaining a spread. Nothing in
the suite currently exercises `toCandidate` against a payload carrying forbidden fields.

**Contract**: A new `describe` block reusing the existing `vi.stubGlobal("fetch", …)` idiom.
The stubbed response body's `results[0]` carries the seven whitelisted fields **plus**
`cuisines`, `dishTypes`, `diets`, `occasions`, `nutrition`, `extendedIngredients`,
`analyzedInstructions`, `pricePerServing`, `healthScore`. Asserts
`Object.keys(result.recipes[0]).sort()` equals the local
`CANDIDATE_FIELDS = ["id", "image", "sourceName", "sourceUrl", "spoonacularSourceUrl", "summary", "title"]`
oracle (comment citing FR-011 + FR-010 + the NFRs). Repeats the same assertion for
`getRecipeById` against a single-object body — that is the slots-1/2 re-fetch path, and its
output also reaches `persist()`.

### Success Criteria

#### Automated Verification

- `recipes` upsert key-set + value + table-name tests pass: `npm test`
- `proposals` insert key-set + table-name tests pass: `npm test`
- `requested_cuisine` provenance test (pinned value; NULL on by-id) passes: `npm test`
- `toCandidate` whitelist tests pass for both `searchRecipes` and `getRecipeById`: `npm test`
- Existing 66 tests still green — no regression from the new fixtures: `npm test`
- Lint incl. strict type-check passes on the dirty-fixture idiom: `npm run lint`

#### Manual Verification

- Change the upsert map to `{ ...p }` in `src/pages/api/proposals.ts:186` → the `recipes` key-set test goes **red**; restore
- Add `summary: p.summary` to the upsert row → the `recipes` key-set test goes **red**; restore
- Add any extra key to the `proposals` insert row → the `proposals` key-set test goes **red**; restore
- Hard-code `requested_cuisine: "thai"` at `src/pages/api/proposals.ts:199` → the provenance test goes **red**; restore
- Add `cuisines: raw.cuisines` to `toCandidate`'s return (`src/lib/spoonacular.ts:63-71`) → the whitelist test goes **red**; restore

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the five mutation checks genuinely
redden before proceeding to Phase 2. A storage test that cannot be made to fail is worse than
no test — it certifies compliance it never verified.

---

## Phase 2: Risk #5 — Request-Side Cuisine Diversity

### Overview

Prove the **delivered** cold-start set spans ≥2 distinct cuisines counted from what the app
requested and recorded; that the untested 200-with-zero-results collapse raises `degraded`
without leaking a compensating call; that a contradictory response `cuisines[]` cannot
influence the count; and that the persisted rows carry the pin unchanged. Includes the
declared drive-by fix of the `CUISINES` mirror test (A5), and — change #6 — the one **risk-#4**
assertion that must live at this layer rather than Phase 1's, because the endpoint test
module-mocks the engine and so cannot observe `fromById`'s NULL provenance. The phase boundary
is risk-per-phase everywhere else; this is the single deliberate exception, and Phase 1's
mutation-check pause therefore does not cover the whole of end-state item 3.

### Changes Required

#### 1. Delivered-set diversity (US-02's actual criterion)

**File**: `src/lib/__tests__/proposals.test.ts`

**Intent**: The existing loop at `:68-93` checks only the *requests*. US-02 binds the
**set** — nothing today asserts the four delivered cards span two cuisines.

**Contract**: A new `describe` block with a `MIN_CUISINES = 2` local oracle citing US-02.
Loops `ITERATIONS` (~30, reusing the existing constant) and asserts
`new Set(proposals.map((p) => p.requestedCuisine)).size` is `>= MIN_CUISINES` and
`degraded === false` on two healthy calls. Must follow the `mockClear()`-not-`mockReset()`
counter idiom (see §Critical Implementation Details) so the two pinned calls return disjoint
id ranges.

#### 2. 200-with-zero-results collapse

**File**: `src/lib/__tests__/proposals.test.ts`

**Intent**: Cover the measured thin-cuisine failure mode — a call returning HTTP 200 with an
empty `results[]` yields a single-cuisine set from two *healthy* calls. Only the failed-call
variant is tested today (`:107-119`), and the two fail differently.

**Contract**: One `searchRecipes` mock resolves `{ ok: true, recipes: [], quota }`, the other
a full result. Asserts `ok: true`, `degraded === true`, the delivered set spans exactly **1**
distinct `requestedCuisine`, `searchRecipes` still called exactly `EXPECTED_CALLS` times, and
`getRecipeById` never called — the risk-#1 no-leak invariant must survive the #5 degrade path.
A second case: **both** calls return `{ ok: true, recipes: [] }` → `ok: true`,
`proposals: []`, `degraded === true` (guards a future "only flag when non-empty" refactor).

#### 3. Diversity survives a contradictory response `cuisines[]`

**File**: `src/lib/__tests__/proposals.test.ts`

**Intent**: The direct refutation of *"the response says 2 cuisines, so we're fine."* This is
the inversion of the anti-pattern `change.md` names — instead of a fixture where `cuisines[]`
happens to be populated agreeably, one where it actively contradicts the pins.

**Contract**: A `dirtyCandidate()` factory (same TS idiom as Phase 1) returning candidates
that carry `cuisines: ["provider-derived"]` and `dishTypes`. Asserts (a) no delivered
proposal has `requestedCuisine === "provider-derived"`, (b) the delivered set's distinct
`requestedCuisine` values equal the set of `cuisine` params read back from
`search.mock.calls` — an oracle derived from observed behaviour, not from a constant — and
(c) **`degraded === false`**: the fixture pins two cuisines and delivers both, so the flag must
stay false even though every recipe's response body reports the single sentinel cuisine. (c) is
what closes end-state item 6 — without it the `??` fall-through mutation at
`src/lib/proposals.ts:335` survives this test, since `toProposed` spreads the candidate
(`:255-259`) and the extra `cuisines` key genuinely reaches `ProposedRecipe` at runtime.
The sentinel must not be a pool member or the test false-reds; see §Critical Implementation Details.

#### 4. Fix the `CUISINES` mirror test (declared drive-by, A5)

**File**: `src/lib/__tests__/proposals.test.ts`

**Intent**: `expect(CUISINES).toContain(params.cuisine)` passes against a wholesale
replacement of the pool — the mirror flaw. Pinning the six *measured* cuisines as a literal
means an unmeasured cuisine cannot be swapped into the pool silently. Note the payload is
**drift protection, not a zero-results gate**: half the six (`chinese`, `greek`, `thai`) return
zero results past offset 50, so membership in the list does not protect against the
200-with-zero-results collapse — `MAX_OFFSET = 20` does, and that bound is already pinned by
`OFFSET_MAX` (`src/lib/__tests__/proposals.test.ts:85-86`).

**Contract**: Add a local `VERIFIED_CUISINES = ["italian", "mexican", "chinese", "greek", "thai", "french"]`
const with a comment citing `context/archive/2026-07-20-cold-start-proposals/plan.md:162-164`
(the authoritative measured list; `spoonacular-retrieval-spike/findings.md:56` is the
corroborating spike signal). Replace **both** occurrences (`:87` in the
cold-start loop and `:205` in the personalized loop) with
`expect(VERIFIED_CUISINES).toContain(params.cuisine)`. This leaves the `CUISINES` import at
`:13` unused — remove it from the import list or lint fails.

#### 5. Persisted rows carry the pin unchanged

**File**: `src/pages/api/__tests__/proposals.test.ts`

**Intent**: The DB-side face of #5, on the **cold-start branch** — the one endpoint branch no
other persistence assertion in the file exercises, and the branch US-02 binds. The endpoint
must carry the engine's per-recipe pin into the row untouched: it must not re-derive, default,
or **collapse** it. Phase 1 change #4 covers the personalized branch; the distinct marginal
coverage here is that a per-recipe pin survives `persist()` one row per recipe. Closes the loop
to `cuisine_affinity`, which reads this column back to drive slot 3.

**Contract**: Drives the endpoint via mocked `buildColdStartSet` with a set whose recipes
carry two distinct pinned cuisines, then asserts the distinct
`requested_cuisine` values across `insert.mock.calls[0][0]` number `>= 2` and equal the
cuisines the fixture pinned, **and that the insert receives one row per proposal** (no dedupe
or collapse). Framed as "carried unchanged," not as "the endpoint guarantees
diversity" — the guarantee is the engine's (change #1 above); this asserts the endpoint does
not destroy it.

#### 6. `fromById` records NULL against a dirty by-id response (engine layer, risk #4)

**File**: `src/lib/__tests__/proposals.test.ts`

**Intent**: The provenance proof Phase 1 change #4 structurally cannot deliver. The endpoint
test module-mocks `@/lib/proposals`, so only this layer can observe that `fromById` passes
`null` into `toProposed` (`src/lib/proposals.ts:346`) even though the by-id response carries a
populated `cuisines[]`. The existing `expect(slot1.requestedCuisine).toBeNull()` (`:252`) runs
against `candidate()`, a **clean** fixture with no `cuisines` key — the very "a clean fixture
cannot fail" trap named in §Key Discoveries. This is what makes end-state item 3 hold on the
by-id branch as well as the search branch.

**Contract**: In the steady-state `describe`, drive `byId.mockImplementation` with a
**dirty** by-id candidate — reuse change #3's `dirtyCandidate()` factory — carrying
`cuisines: ["thai"]`, then assert the slot-1/2 proposals have `requestedCuisine === null`.
Reuses `mockSteadyProviders()` (`:169-179`); one `it` block, no new mock wiring. If
`dirtyCandidate()`'s wider-than-`RecipeCandidate` variable does not satisfy
`byId.mockImplementation`'s inferred return type, apply the §Critical Implementation Details
fallback rather than widening the production type.

### Success Criteria

#### Automated Verification

- Delivered-set ≥2-cuisine test passes across ~30 iterations: `npm test`
- 200-with-zero-results collapse test passes (single-cuisine set + `degraded`, exactly 2 calls, 0 by-id): `npm test`
- Double-zero-results test passes (empty set + `degraded`): `npm test`
- Contradictory-`cuisines[]` test passes, including `degraded === false`: `npm test`
- By-id NULL provenance test passes against a dirty by-id candidate: `npm test`
- Both `CUISINES` mirror assertions replaced; the now-unused import removed: `npm run lint`
- Persisted-rows-carry-the-pin test passes (values + one row per proposal): `npm test`
- Full suite green: `npm test`

#### Manual Verification

- Change `toProposed(resultB.recipes, cuisineB)` to `toProposed(resultB.recipes, cuisineA)` in `src/lib/proposals.ts:323-328` → the delivered-set diversity test goes **red**; restore
- Hard-code `degraded: false` at `src/lib/proposals.ts:337` → the zero-results collapse test goes **red**; restore
- Change `src/lib/proposals.ts:335` to `new Set(proposals.map((p) => (p as { cuisines?: string[] }).cuisines?.[0] ?? p.requestedCuisine)).size` → the contradictory-`cuisines[]` test goes **red**; restore
- Source `fromById`'s cuisine from `result.recipes[0].cuisines?.[0]` at `src/lib/proposals.ts:346` → the by-id NULL provenance test goes **red**; restore
- Add `"american"` to `CUISINES` (`src/lib/proposals.ts:5`) → the `VERIFIED_CUISINES` assertion goes **red** across the loop, where the old imported-constant version would have stayed green; restore
- Dedupe the `proposals` insert rows by `spoonacular_id` in `persist()` (`src/pages/api/proposals.ts:196`) → the persisted-pin test goes **red**; restore

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the six mutation checks genuinely
redden before proceeding to Phase 3.

---

## Phase 3: Cookbook + Rollout Status Sync

### Overview

Record what this slice taught in the test-plan cookbook and close out rollout Phase 1 honestly
— all three of its risks (#1, #4, #5) now have automated gates.

### Changes Required

#### 1. Cookbook §6.1 — storage & diversity patterns

**File**: `context/foundation/test-plan.md`

**Intent**: §6.1 currently documents the risk-#1 interception patterns and the oracle rule.
Add the two assertion-shape lessons this slice established, which generalise beyond these
risks.

**Contract**: Append 3–4 lines to §6.1: **assert closed key sets** (`Object.keys(row).sort()`
against a hard-coded literal), never per-field `toBeUndefined()` — an enumeration misses the
next field added; **make compliance fixtures deliberately dirty** — a clean fixture cannot
fail, which is how a storage test passes while the leak ships; and **derive an oracle from
observed call args** (e.g. cuisines read back from `search.mock.calls`) when a constant would
mirror the implementation. Point at the three test files as worked examples. Keep it terse.

#### 2. §6.6 per-rollout-phase note

**File**: `context/foundation/test-plan.md`

**Intent**: The 2–3 line note §6.6 invites after each phase lands.

**Contract**: Records that risk #4's exposure was **not** a missing schema constraint but an
unnarrowed argument — `persist()` receives the wide `ProposedRecipe[]`, so a one-character
spread would ship `excerpt` (a derived form of `summary`) into a write; and that risk #5's
residual exposure was **not** request-vs-response (the response's `cuisines[]` is structurally
unreachable) but request-guarantee-vs-delivered-guarantee, via the 200-with-zero-results
collapse.

#### 3. Rollout status + gate note

**File**: `context/foundation/test-plan.md`

**Intent**: §3 Phase 1 currently reads `implementing (risk #1 shipped; #4/#5 change opened)`.
With this slice landed, Phase 1 is genuinely `complete`.

**Contract**: §3 Phase 1 Status → `complete`; the Change folder cell lists both slices without
the "(#1, shipped)" qualifier. §5's unit-gate row (`test-plan.md:128`) drops "#4/#5 pending"
and its Catches cell notes the gate now covers quota/call-count, storage-field, and diversity.

Its **Required?** cell must also separate satisfaction from enforcement — `required after §3
Phase 1` → `runnable locally now; enforced in CI after §3 Phase 4`. Flipping Phase 1 to
`complete` otherwise flips that gate to enforced by §5's own definition, while
`.github/workflows/ci.yml` runs only `npm ci` / `astro sync` / `lint` / `build` — **there is no
`npm test` step**, and wiring one is out of scope (rollout Phase 4, whose row already owns
"enforce the test gates in CI"). Without this edit, `complete` claims an enforcement that does
not exist and a regression that reddens locally still merges.

Also amend the §3 **Phase 3** row (`test-plan.md:86`) so `Risks covered` reads
`#2, #3, #7, #4 (schema-column half)` and its Goal cell gains "…and confirm the `recipes`
column set against a live schema" — giving A3's deferred migration-column assertion a named
owner in the table the orchestrator reads. Do **not** file it under §7: that section is
"What We Deliberately Don't Test," and a temporary deferral recorded there becomes a permanent
exclusion. The header `Last updated:` line is bumped to today with a one-clause summary.

#### 4. Change identity

**File**: `context/changes/testing-storage-diversity-units/change.md`

**Intent**: Close the change out.

**Contract**: `status:` → `complete`; `updated:` bumped; a Notes line recording that risks #4
and #5 shipped, that rollout Phase 1 is now closed, and that the two follow-ons this slice
deliberately did not take are the `Pick<>` typed row helper (A6) and risk #7 / the migration
schema assertion (Phase 3). This plan's `## Progress` remains the per-step execution ledger.

### Success Criteria

#### Automated Verification

- Full suite still green after doc edits: `npm test`

#### Manual Verification

- §3 Phase 1 Status cell reads `complete`; the Change folder cell lists both slices without the `(#1, shipped)` qualifier (a reader check — `npm run lint` is `eslint .` and does not read markdown)
- A reader can add a storage-discipline test from §6.1 alone, using the three files as worked examples
- §3 Phase 1 `complete` is honest — every risk it claims (#1, #4, #5) has a runnable gate, and §5's unit-gate Required? cell says enforcement lands in CI at rollout Phase 4
- The A3 deferral is visible in the test plan — §3's Phase 3 row names `#4 (schema-column half)` — not only in this change folder

**Implementation Note**: Final phase. After this, rollout Phase 1 is closed and rollout
Phase 2 (integration + component, risks #1/#6) is the next change.

---

## Testing Strategy

### Unit Tests

**Risk #4 — storage-field discipline**

- DB boundary (`src/pages/api/__tests__/proposals.test.ts`): `recipes` upsert row key set is exactly `["image", "spoonacular_id", "title"]` against a dirty fixture; `proposals` insert row key set is exactly the four app-owned columns; correct table names on the correct clients; `requested_cuisine` equals the pin and is `null` on by-id rows even when the fixture carries a contradictory `cuisines[]`.
- HTTP edge (`src/lib/__tests__/spoonacular.test.ts`): `toCandidate` projects exactly the seven-field whitelist from a payload carrying `cuisines`, `dishTypes`, `diets`, `occasions`, `nutrition`, `extendedIngredients`, `analyzedInstructions` — for both `searchRecipes` and `getRecipeById`.

**Risk #5 — request-side cuisine diversity**

- Engine (`src/lib/__tests__/proposals.test.ts`): delivered cold-start set spans ≥2 distinct `requestedCuisine` across ~30 iterations; 200-with-zero-results collapses to 1 cuisine and raises `degraded` with no compensating call; double-zero-results yields an empty set with `degraded`; a contradictory response `cuisines[]` never reaches `requestedCuisine` and does not move `degraded`; `fromById` records `null` against a by-id response carrying `cuisines[]` (the risk-#4 provenance proof, which only this layer can observe); pinned cuisines are members of the measured six.
- DB boundary: persisted `requested_cuisine` values carry the engine's pin unchanged, one row per proposal.

**Edge cases explicitly covered**: dirty provider payload (both tiers), dirty by-id response
with a populated `cuisines[]`, one healthy + one empty call, two empty calls, contradictory
`cuisines[]`, unmeasured cuisine in the pool.

### Integration Tests

None this slice. Real RLS, real FK enforcement, and the migration's actual column set are
rollout Phase 3 against a local Supabase (A1, A3).

### Manual Testing Steps

1. `npm test` → full suite green (66 existing + the new blocks).
2. Run every mutation check listed in Phases 1 and 2, restoring after each. **Each must go
   red.** A green mutation check means the test is decorative.
3. `npm run lint` → clean, including the dirty-fixture TypeScript idiom and the removed
   `CUISINES` import.
4. `npm run astro sync && npm run build` → unaffected (test-only slice).

## Performance Considerations

None. All provider calls and both Supabase clients are stubbed; the suite is CPU-only, spends
zero Spoonacular quota, and adds no runtime dependency to the app bundle. The two ~30-iteration
loops match the existing risk-#1 convention and add negligibly to the ~4.2 s suite time.

## Migration Notes

Test-only and additive. No production code changes (A6), no schema change, no data migration.
The one edit to existing test code — replacing two `expect(CUISINES).toContain(...)`
assertions and removing the now-unused import — is a declared in-scope drive-by (A5), not
silent drift.

## References

- Grounding research: `context/changes/testing-storage-diversity-units/research.md`
- Change identity: `context/changes/testing-storage-diversity-units/change.md`
- Test strategy: `context/foundation/test-plan.md` (§2 risks #4/#5 + Risk Response Guidance, §3 Phase 1, §6.1)
- Predecessor slice (harness + oracle discipline): `context/changes/testing-harness-proposal-units/plan.md`
- The only provider-derived write: `src/pages/api/proposals.ts:185-188`
- `persist()` receives the wide object: `src/pages/api/proposals.ts:147,162-166`
- `proposals` insert / `requested_cuisine`: `src/pages/api/proposals.ts:195-202`
- Request-side pin attachment: `src/lib/proposals.ts:254-260`
- The ≥2-cuisine computation: `src/lib/proposals.ts:330-337`
- By-id records NULL cuisine: `src/lib/proposals.ts:346`
- The HTTP-edge whitelist: `src/lib/spoonacular.ts:6-14,54-72`
- Final `recipes` schema + request-side intent comment: `supabase/migrations/20260720181257_cold_start_proposals.sql:10-19,25-26`
- `cuisine_affinity` consumes `requested_cuisine`: `supabase/migrations/20260809120000_personalized_proposal_slots.sql:48-61`
- Existing persistence tests (and the gap): `src/pages/api/__tests__/proposals.test.ts:270-291`
- Existing diversity loop + mirror flaw: `src/lib/__tests__/proposals.test.ts:68-93` (`:87`), `:205`
- Measured thin-cuisine finding: `context/archive/2026-07-20-cold-start-proposals/plan.md:163-165`
- Original storage decision: `context/archive/2026-07-20-cold-start-proposals/plan.md:84-102`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Risk #4 — Storage-Field Discipline (Both Tiers)

#### Automated

- [x] 1.1 `recipes` upsert key-set + value + table-name tests pass — 74b34a9
- [x] 1.2 `proposals` insert key-set + table-name tests pass — 74b34a9
- [x] 1.3 `requested_cuisine` provenance test (pinned value; NULL on by-id) passes — 74b34a9
- [x] 1.4 `toCandidate` whitelist tests pass for both `searchRecipes` and `getRecipeById` — 74b34a9
- [x] 1.5 Existing 66 tests still green — no regression from the new fixtures — 74b34a9
- [x] 1.6 Lint incl. strict type-check passes on the dirty-fixture idiom — 74b34a9

#### Manual

- [ ] 1.7 `{ ...p }` in the upsert map reddens the `recipes` key-set test (then restored)
- [ ] 1.8 Adding `summary` to the upsert row reddens the `recipes` key-set test (then restored)
- [ ] 1.9 An extra key on the `proposals` insert row reddens the `proposals` key-set test (then restored)
- [ ] 1.10 Hard-coding `requested_cuisine: "thai"` reddens the provenance test (then restored)
- [ ] 1.11 Adding `cuisines` to `toCandidate`'s return reddens the whitelist test (then restored)

### Phase 2: Risk #5 — Request-Side Cuisine Diversity

#### Automated

- [x] 2.1 Delivered-set ≥2-cuisine test passes across ~30 iterations
- [x] 2.2 200-with-zero-results collapse test passes (single-cuisine set + `degraded`, exactly 2 calls, 0 by-id)
- [x] 2.3 Double-zero-results test passes (empty set + `degraded`)
- [x] 2.4 Contradictory-`cuisines[]` test passes, including `degraded === false`
- [x] 2.5 By-id NULL provenance test passes against a dirty by-id candidate
- [x] 2.6 Both `CUISINES` mirror assertions replaced; the now-unused import removed
- [x] 2.7 Persisted-rows-carry-the-pin test passes (values + one row per proposal)
- [x] 2.8 Full suite green

#### Manual

- [ ] 2.9 Pinning both groups to the same cuisine reddens the delivered-set diversity test (then restored)
- [ ] 2.10 Hard-coding `degraded: false` reddens the zero-results collapse test (then restored)
- [ ] 2.11 The `cuisines?.[0] ?? requestedCuisine` fall-through at `:335` reddens the contradictory-`cuisines[]` test (then restored)
- [ ] 2.12 Sourcing `fromById`'s cuisine from the response `cuisines[]` at `:346` reddens the by-id NULL provenance test (then restored)
- [ ] 2.13 Adding `"american"` to `CUISINES` reddens the `VERIFIED_CUISINES` assertion (then restored)
- [ ] 2.14 Deduping the `proposals` insert rows by `spoonacular_id` reddens the persisted-pin test (then restored)

### Phase 3: Cookbook + Rollout Status Sync

#### Automated

- [ ] 3.1 Full suite still green after doc edits

#### Manual

- [ ] 3.2 §3 Phase 1 Status cell reads `complete`; the Change folder cell lists both slices without the `(#1, shipped)` qualifier
- [ ] 3.3 A reader can add a storage-discipline test from §6.1 alone
- [ ] 3.4 §3 Phase 1 `complete` is honest — every risk it claims (#1, #4, #5) has a runnable gate, and §5's Required? cell defers CI enforcement to rollout Phase 4
- [ ] 3.5 The A3 deferral is visible in the test plan — §3's Phase 3 row names `#4 (schema-column half)`
