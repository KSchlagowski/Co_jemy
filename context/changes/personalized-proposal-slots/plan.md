# Personalized 4-Slot Proposals (S-05) Implementation Plan

## Overview

Build the steady-state proposal engine: a user with rating history gets a 4-slot set — slot 1 recently liked, slot 2 liked but not proposed in ≥2 weeks, slot 3 new recipe matching the inferred (cuisine) taste profile, slot 4 random discovery from a different cuisine — with 👎-rated recipes permanently excluded (FR-009) and slot logic activating progressively while the existing cold-start path remains the fallback. This is the product's core hypothesis (US-01, FR-008).

## Current State Analysis

From `context/changes/personalized-proposal-slots/research.md` (authoritative; not re-derived here):

- **Pre-paved**: `getRecipeById` exists as dead code built for slots 1/2 (`src/lib/spoonacular.ts:136-141`); `proposals` records `requested_cuisine` + `proposed_at` with an S-05 index; `ratings.rated_at` carries "when the verdict was last expressed" semantics chosen for slot 1; `requested_type` is reserved and stays NULL this slice.
- **Missing**: any DB read path (all 3 `supabase.from()` calls are writes); a slot concept anywhere; rating-state hydration on cards; a `ratings ⋈ proposals` join capability (no FK → PostgREST embedding impossible); indexes `proposals(user_id, spoonacular_id, proposed_at desc)` and a partial dislike index; `SearchParams` has no exclude-by-id, so FR-009 is post-fetch filtering over the over-fetched pool.
- **Quota reality**: 1 pt/call + 0.035/recipe (measured, 0% deviation); by-id = 1.00 pt; the documented 4.70-pt steady-state figure is stale against shipped `number=20`.
- **Cold-start code**: `buildColdStartSet()` (`src/lib/proposals.ts:253-277`) is pure, takes no arguments, has no exclusion capability; the wrong-reason bug at `src/lib/proposals.ts:263` returns `resultA.reason` unconditionally on double failure.

## Desired End State

`POST /api/proposals` reads the user's history first, then: with no likes it runs the (now dislike-aware) cold-start path; with likes it assembles a personalized set costing exactly 2 `complexSearch` calls + ≤2 by-id calls (~5.40 pts), where each card carries a `slot` label and its stored rating verdict, 👎-rated recipes never appear, and every shown recipe appends a `proposals` event row.

Verify by: unit suite green (engine, endpoint, budget assertion); manual production flow — rate several recipes, re-propose, observe slot 1 shows a recently liked recipe with the 👍 pre-selected, and a 👎-rated recipe never reappears.

### Key Discoveries:

- Both S-05 access-path indexes and view-free reads are granted to the session client already — no new RLS policies needed for reads (research §Architecture Insights 3).
- `proposals` is append-only by design (no UPDATE grant): "last proposed at" = `max(proposed_at)`; steady-state slots must keep inserting event rows or slot 2's semantics rot (research §Architecture Insights 2).
- The cold-start test suite deliberately scopes `expect(getRecipeById).not.toHaveBeenCalled()` to `buildColdStartSet` (`src/lib/__tests__/proposals.test.ts:76-77`) — new steady-state tests must assert their own budget without tripping that oracle.
- A rating can exist with zero matching `proposals` rows (no ownership check in ratings endpoint) — taste-profile aggregation must tolerate cuisine-less likes.

## What We're NOT Doing

- **No `recipes` open-insert hardening** (lessons.md lesson 2): slots 1/2 render exclusively from live `getRecipeById` responses, never stored `title`/`image`, so the lesson-2 trigger ("stored rows rendered back to users") does not fire; hardening stays filed with S-04.
- **No `requested_type` / meal-type facet**: stays NULL; taste profile is cuisine-only.
- **No E2E tests**: test-plan Phase 3/4 opens after this slice; rating cleanup is impossible until S-04's DELETE policy, so an S-05 e2e that rates would leak rows.
- **No retry/surfacing for `recorded:false`** history gaps — accepted MVP noise (slot 2 may occasionally miss a set the user saw).
- **No runtime quota ledger** — `QuotaInfo` stays parsed-and-discarded; the dev cap and 402 handling are unchanged.
- **No slot-4 "any cuisine" widening** beyond the frozen `CUISINES` six.
- No rating change/delete UI (S-04), no ML, no `diet` filters.

## Implementation Approach

Keep the engine/persistence split: history reads live in a new `src/lib/history.ts` (session client in, plain data out, aggregation pushed into SQL views); slot assembly stays a pure, unit-testable function in `src/lib/proposals.ts` that receives history data and calls the provider. The endpoint inverts to history-before-provider and remains the single owner of persistence and the wire type.

**Decided defaults (tunable constants, assert from PRD/research values — never import them into tests):**

- `SLOT1_MIN_LIKES = 1` — slot 1 activates at the first like.
- `SLOT2_STALE_DAYS = 14` — slot 2 needs ≥1 like whose `last_proposed_at` is older than 14 days (PRD's "≥2 weeks").
- `SLOT3_MIN_LIKES = 5` — slot 3's profile activates at 5 likes with a non-empty cuisine affinity (PRD Socrates hint "fewer than 5–10 ratings" has no reliable signal).
- **Taste aggregation rule**: count every `proposals` event's `requested_cuisine` across liked recipes; highest count wins; ties broken by most recent event. Cuisine-less likes contribute nothing.
- **Progressive activation**: any inactive or unfillable slot backfills from the two searches' over-fetched pool. `degraded` is true only when an **active** slot 1–3 could not be filled as designed (failed by-id, failed search, pool exhausted after exclusion) — an inactive slot backfilling is expected early-stage behavior, not degradation, so a 1-like user with healthy calls never sees a warning banner (plan-review F1).
- **Steady-state call shape** (per Quota decision): slot 3 search pins the top affinity cuisine, slot 4 search pins a random *different* cuisine from `CUISINES`, both at `number=20`; slots 1/2 are by-id re-fetches. All four provider calls run concurrently. Cost: 2×1.70 + 2×1.00 = **5.40 pts/set ≈ 9 sets/day**.

## Critical Implementation Details

- **Views must be `security_invoker`**: Supabase views are owned by `postgres` and bypass RLS by default. Both new views must be created `WITH (security_invoker = true)` or they leak other users' ratings/proposals through PostgREST.
- **`requested_cuisine` goes nullable**: slots 1/2 request no cuisine, and the column is `NOT NULL`. The migration drops the constraint; by-id proposal events insert NULL; the affinity view filters `requested_cuisine IS NOT NULL`. A sentinel string was rejected — it would pollute the affinity count.
- **FR-009 binds the cold-start path too**: a user with only dislikes still routes to cold-start, so `buildColdStartSet` gains an `excludeIds` parameter and the endpoint always fetches the dislike set before building either mode. Exclusion keys on the integer `spoonacular_id` (test-plan risk #3).
- **Ordering**: history reads (and the 401 self-check) must complete before any provider call — the reverse of today's provider-first flow. DB reads are quota-free; provider calls are not.
- **Rating hydration under the React compiler**: pass the stored verdict as a prop and seed card state via `useState(initialVerdict)` — no effects, no conditional hooks.
- **Cold-start oracle**: new steady-state tests assert "exactly 2 `searchRecipes` + ≤2 `getRecipeById`" in their own describe block; do not widen or touch the cold-start two-call invariant.

## Phase 1: Migration + History Read Layer

### Overview

Land the SQL surface (2 views, 2 indexes, 1 constraint change) and the repo's first DB read module, with no behavior change to the live flow.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<timestamp>_personalized_proposal_slots.sql`

**Intent**: Give slot 2 and slot 3 index-backed, RLS-safe SQL aggregation, and let by-id proposal events record honestly.

**Contract**:
- `ALTER TABLE proposals ALTER COLUMN requested_cuisine DROP NOT NULL;`
- View `liked_recipe_history(user_id, spoonacular_id, rated_at, last_proposed_at)` — `ratings` (verdict = 'like') LEFT JOIN `proposals` on `(user_id, spoonacular_id)`, grouped per recipe with `max(proposed_at) AS last_proposed_at` (NULL when never recorded). `WITH (security_invoker = true)`; grant SELECT to `authenticated`.
- View `cuisine_affinity(user_id, requested_cuisine, like_events, last_event_at)` — count of proposal events with non-NULL `requested_cuisine` joined to like verdicts, grouped by cuisine, plus `max(proposed_at) AS last_event_at` so the decided recency tie-break is implementable (plan-review F5). Same security/grants.
- Index `proposals(user_id, spoonacular_id, proposed_at DESC)`; partial index `ratings(user_id, spoonacular_id) WHERE verdict = 'dislike'`. Comment each with its S-05 consumer, matching the existing migrations' style.

#### 2. History read module

**File**: `src/lib/history.ts` (new)

**Intent**: All S-05 DB reads in one place — session client in, plain serializable data out, so the engine stays pure and the endpoint stays thin.

**Contract**: exports (each takes the request's `SupabaseClient`):
- `getRecentLikes(client)` → `{ spoonacularId, ratedAt }[]` from `ratings` (verdict = 'like', ordered `rated_at DESC`, unbounded — MVP cardinality is small, and the full id set doubles as the slots-3/4 liked-id exclusion list, plan-review F2).
- `getStaleLikes(client, cutoffISO)` → from `liked_recipe_history` where `last_proposed_at < cutoff` **or `last_proposed_at IS NULL`** (a like with no recorded proposal event is literally "not proposed in ≥2 weeks" — treat as maximally stale; plan-review F4), ordered oldest-first, NULLs first.
- `getDislikedIds(client)` → `number[]` from `ratings` (verdict = 'dislike').
- `getTopCuisine(client)` → `string | null` from `cuisine_affinity` ordered by `like_events DESC, last_event_at DESC` (the decided most-recent-event tie-break).
Untyped string-keyed queries matching the existing convention (no generated DB types this slice). No `getVerdictMap`: `ratingVerdict` derives from slot construction (see Phase 3, plan-review F2).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly on the linked project: `npx supabase db push` (or `db reset` locally)
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- In Supabase SQL editor as an authenticated user, both views return only that user's rows (security_invoker verified with two test accounts)
- Existing propose/rate flow on production is unchanged after deploy

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Slot Assembly Engine

### Overview

The pure personalized set builder with thresholds, exclusion, dedupe, backfill, and the 5.40-pt call shape — fully unit-tested before any endpoint wiring.

### Changes Required:

#### 1. Engine

**File**: `src/lib/proposals.ts`

**Intent**: `buildPersonalizedSet(history)` assembles the 4-slot set from history data + provider calls; slot rules and thresholds live here as exported-for-nothing tunable constants.

**Contract**:
- Input: `{ recentLikes, staleLikes, dislikedIds, topCuisine }` (Phase 1 shapes). Output mirrors `buildColdStartSet`'s result union, extended with per-item `slot: 1 | 2 | 3 | 4` and set-level `degraded`.
- Slot 1 = most recent like (`getRecipeById`); slot 2 = oldest stale like distinct from slot 1 (`getRecipeById`); slot 3 = first pool candidate from the affinity-cuisine search; slot 4 = first candidate from the other-cuisine search. Slot 3 pins `topCuisine` when active, else a random cuisine; slot 4 pins a random `CUISINES` member ≠ slot 3's.
- All four provider calls issued concurrently. Every pool candidate (slots 3/4 and any backfill) passes a rated-id filter — dislikes (FR-009, absolute) **and** likes, so an already-liked recipe never poses as "new" (plan-review F2) — and dedupes against already-filled slots. Pool exhausted after exclusion → the slot stays unfilled ("up to 4").
- Backfill: a failed by-id, an inactive slot, or an exhausted rule takes the next unused pool candidate; `degraded: true` only when an **active** slot 1–3 fell back or went unfilled — inactive-slot backfill is silent (plan-review F1).
- Whole-set failure only when nothing is buildable; when multiple calls fail with different reasons, prefer `quota_exhausted` over transport reasons (fixes the wrong-reason bug at `src/lib/proposals.ts:263` — apply the same preference to the cold-start double-failure branch).
- `buildColdStartSet(excludeIds?: number[])` — new optional parameter, filter applied before interleave/slice.
- `ProposedRecipe.requestedCuisine` and the wire `ProposalPayload.requestedCuisine` widen to `string | null` (by-id slots have no pinned cuisine; `toProposed` accepts null). Verified: no UI or test reads the field — only `persist()` maps it through (plan-review F6).

#### 2. Engine tests

**File**: `src/lib/__tests__/proposals.test.ts` (extend, new describe blocks)

**Intent**: First coverage for `getRecipeById` shape and the steady-state budget; slot-rule truth table.

**Contract**: mock `@/lib/spoonacular` per existing pattern. Must cover: budget assertion (exactly 2 searches at over-fetch size, ≤2 by-id; 5.40-pt reconciliation asserted from research constants, not imports); FR-009 exclusion incl. non-empty rating set (test-plan risk #3 anti-pattern is testing with an empty one); liked ids excluded from pool slots (a liked recipe never fills slot 3/4); threshold activation matrix (0 likes → not called; 1 like → slot 1 only with `degraded: false`; stale like → slot 2; 5 likes + affinity → slot 3 pinned); by-id failure → backfill + `degraded`; dedupe slot1=slot2 candidate; reason preference on double failure; cold-start `excludeIds`. Cold-start oracle untouched.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

_None — pure logic phase; behavior reaches users in Phase 3._

---

## Phase 3: Endpoint Wiring + Payload Extension

### Overview

Invert `POST /api/proposals` to history-first, route between modes, extend the wire type, persist slot events.

### Changes Required:

#### 1. Endpoint

**File**: `src/pages/api/proposals.ts`

**Intent**: Read history → pick mode → build set → hydrate verdicts → persist events → respond, preserving the envelope, status map, and secret-hygiene invariants.

**Contract**:
- After the 401 self-check: fetch dislike ids + like counts (Phase 1 module). Mode rule: ≥1 like → `buildPersonalizedSet`; else `buildColdStartSet(dislikedIds)`.
- `ProposalPayload` gains `slot: 1 | 2 | 3 | 4` and `ratingVerdict: 'like' | null` (👎 never ships in a set; the verdict derives from construction — a slot-1/2 item filled by its own by-id fetch is `'like'`, every other item `null`; liked ids never enter the pool, so no DB lookup is needed — plan-review F2). The envelope gains set-level `mode: 'cold_start' | 'personalized'`; cold-start items carry positional slots 1..N (plan-review F3). Extend the types at the endpoint only — `types.ts` re-export propagates (S-02 impl-review F5).
- `persist()` unchanged in shape; personalized sets append `proposals` rows for **all four** slots — by-id slots with `requested_cuisine: null`, search slots with their pinned cuisine. `recorded:false` tolerance unchanged.
- Status map unchanged; `degraded` passes through as today.

#### 2. Endpoint tests

**File**: `src/pages/api/__tests__/proposals.test.ts` (extend or create alongside ratings pattern)

**Intent**: Mode routing, hydration, and persistence rows are the endpoint's new obligations.

**Contract**: cover: 0 likes → cold-start called with dislike exclusion; ≥1 like → personalized path and **no provider call before history reads resolve**; payload carries `slot` + `ratingVerdict` and the envelope carries `mode`; persist receives 4 rows with NULL cuisine on by-id slots; 402 → `quota_exhausted`/402 mapping on the personalized path.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Production: account with ratings gets a personalized set; network tab shows one POST; response items carry `slot` and `ratingVerdict`
- A 👎-rated recipe does not appear across repeated proposal requests
- `proposals` table shows 4 new rows per set, NULL cuisine on slots 1/2

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: UI — Slots + Rating Hydration

### Overview

Make personalization observable: hydrated thumbs, slot labels, honest degraded copy; retire the stale quota docs.

### Changes Required:

#### 1. Card hydration

**File**: `src/components/proposals/RecipeCard.tsx`

**Intent**: A card whose recipe is already liked renders with 👍 pre-selected — without it, slots 1/2 visibly contradict the rating history.

**Contract**: new `initialVerdict` prop from the payload's `ratingVerdict`; seed `useState(initialVerdict)` replacing the hardcoded `null` at `RecipeCard.tsx:41`. Rating POST flow, link discipline, and credit rendering unchanged.

#### 2. Slot presentation + copy

**File**: `src/components/proposals/ProposalList.tsx`

**Intent**: Surface why each card is there, and stop the degraded banner lying about cuisines when a slot fell back.

**Contract**: per-card slot badge keyed off `slot` (1 "Recently liked", 2 "Worth revisiting", 3 "Matches your taste", 4 "Something new"); badges render only when the envelope's `mode` is `'personalized'` — cold-start sets render without badges (plan-review F3). Degraded copy also keys off `mode`: personalized → "Some proposals couldn't be personalized this time."; cold-start keeps the existing single-cuisine copy.

#### 3. Docs refresh

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Replace the stale 2.71/4.70 quota rows with the shipped shapes.

**Contract**: cold-start 3.40 pts/set; steady-state 5.40 pts/set ≈ 9 sets/day; note the 2-search + ≤2-by-id invariant as the tested budget.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Slot-1 card shows its 👍 pre-selected on load; toggling still round-trips to the server
- Slot badges render on a personalized set; cold-start set renders sensibly for a fresh account
- Mobile layout intact with badges
- Full loop on production: rate → re-propose → observably shaped set (US-01 acceptance criteria)

---

## Testing Strategy

### Unit Tests:

- Engine truth table: threshold activation matrix, FR-009 exclusion with non-empty rating set, cross-slot dedupe, backfill + degraded semantics, failure-reason preference
- Budget oracle: exactly 2 searches + ≤2 by-id per personalized set; 5.40-pt reconciliation from research constants; cold-start two-call oracle untouched
- `getRecipeById`: URL shape, single-object extraction, 402 branch (first-ever coverage)
- Endpoint: mode routing, hydration fields, persist row shapes (NULL cuisine), status map on personalized path

### Integration Tests:

- None this slice (no jsdom, E2E deferred to test-plan Phase 3/4 after S-04 lands DELETE).

### Manual Testing Steps:

1. Two-account RLS check on both views (Phase 1)
2. Fresh account → cold-start unchanged; rate 1 like → next set has slot-1 = that recipe with 👍 pre-selected
3. Rate a 👎 → recipe absent across ≥3 consecutive sets
4. Accumulate 5 likes in one cuisine → slot 3 pins that cuisine (check `requested_cuisine` in the new proposals rows)
5. Verify quota spend for one personalized set ≈ 5.40 pts via `X-API-Quota-Used` in `wrangler tail`

## Performance Considerations

Aggregation lives in Postgres views (Workers CPU-light constraint); all four provider calls run concurrently so latency ≈ one provider round trip; history reads are two-to-three cheap indexed queries before the provider fan-out.

## Migration Notes

Forward-only migration; `requested_cuisine DROP NOT NULL` is backward-compatible with all existing rows and code (S-02 writes always provide it). No data backfill needed. Rollback = drop views/indexes, re-add NOT NULL (valid while no NULL rows exist).

## References

- Related research: `context/changes/personalized-proposal-slots/research.md`
- Cold-start engine + tests: `src/lib/proposals.ts:253-277`, `src/lib/__tests__/proposals.test.ts`
- Ratings semantics: `src/pages/api/ratings.ts:86-94`
- Prior plans: `context/archive/2026-07-20-cold-start-proposals/plan.md`, `context/archive/2026-08-08-rate-recipe/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Migration + History Read Layer

#### Automated

- [x] 1.1 Migration applies cleanly (`npx supabase db push` / local reset)
- [x] 1.2 Lint passes: `npm run lint`
- [x] 1.3 Build passes: `npm run build`

#### Manual

- [x] 1.4 Two-account security_invoker RLS check on both views
- [x] 1.5 Existing propose/rate flow unchanged on production

### Phase 2: Slot Assembly Engine

#### Automated

- [ ] 2.1 Unit tests pass: `npm test`
- [ ] 2.2 Lint passes: `npm run lint`
- [ ] 2.3 Build passes: `npm run build`

### Phase 3: Endpoint Wiring + Payload Extension

#### Automated

- [ ] 3.1 Unit tests pass: `npm test`
- [ ] 3.2 Lint passes: `npm run lint`
- [ ] 3.3 Build passes: `npm run build`

#### Manual

- [ ] 3.4 Personalized set on production with `slot` + `ratingVerdict` in payload
- [ ] 3.5 👎-rated recipe absent across repeated requests
- [ ] 3.6 4 proposals rows per set, NULL cuisine on by-id slots

### Phase 4: UI — Slots + Rating Hydration

#### Automated

- [ ] 4.1 Unit tests pass: `npm test`
- [ ] 4.2 Lint passes: `npm run lint`
- [ ] 4.3 Build passes: `npm run build`

#### Manual

- [ ] 4.4 Hydrated 👍 on slot-1 card; toggle still round-trips
- [ ] 4.5 Slot badges correct on personalized vs cold-start sets
- [ ] 4.6 Mobile layout intact
- [ ] 4.7 Full US-01 loop verified on production (~5.40 pts/set via quota headers)
