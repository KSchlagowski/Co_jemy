<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Personalized 4-Slot Proposals (S-05)

- **Plan**: context/changes/personalized-proposal-slots/plan.md
- **Mode**: Deep
- **Date**: 2026-08-08
- **Verdict**: REVISE → SOUND after applied fixes
- **Findings**: 0 critical, 5 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

9/9 paths ✓, 6/6 symbols ✓ (`getRecipeById` at spoonacular.ts:136-141; `buildColdStartSet` at proposals.ts:253-277; wrong-reason bug at :263; `ProposalPayload` at api/proposals.ts:22-31; hardcoded null verdict at RecipeCard.tsx:41; cold-start oracle at proposals.test.ts:78-79), brief↔plan ✓. Blast radius verified clean by sub-agent: no UI, unit, or e2e consumer reads `requestedCuisine` or asserts the degraded copy; `npm test` = `vitest run` exists; exactly 3 `supabase.from()` call sites, all writes (plan claim confirmed); only 2 migrations, no views/RPCs. Contract-surfaces check: quota-table update (3.40/5.40) recomputes correctly; `src/lib/spoonacular.ts` public surface untouched; views derive only from FR-011-permitted stored fields.

## Findings

### F1 — `degraded` fires for every early-stage user (inactive ≠ failed)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Implementation Approach (Progressive activation) + Phase 2 backfill contract + Phase 4 copy
- **Detail**: The plan sets `degraded: true` when *any* personalized slot 1–3 fell back, and backfill explicitly covers "an inactive slot". A user with exactly 1 like has slots 2 and 3 inactive by design, so every set until ~5 likes AND a 14-day-stale like shows the Phase 4 banner "Some proposals couldn't be personalized this time." — a persistent warning for the entire early cohort during normal, healthy operation. This contradicts the plan's own "honest degraded copy" intent and the PRD's cold-start principle ("does not feel like an error"). Rating your first recipe would *create* a warning banner that cold-start never showed.
- **Fix ⭐ Recommended**: Redefine `degraded` = an **active** slot could not be filled as designed (failed by-id, failed search, pool exhausted after exclusion); inactive-slot backfill is silent.
  - Strength: Matches what the banner copy claims; early users see a clean set; provider failures still surface.
  - Tradeoff: The flag no longer reveals "personalization not fully active yet" — acceptable, slot badges already convey what was personalized.
  - Confidence: HIGH — the plan's own Phase 4 intent ("stop the degraded banner lying") argues for this reading.
  - Blind spot: None significant.
- **Decision**: FIXED (recommended fix applied)

### F2 — Liked recipes can fill slots 3/4, breaking "new" semantics

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 2 — candidate filtering contract
- **Detail**: Pool candidates pass only "the dislike filter and dedupe against already-filled slots". A previously liked recipe not chosen for slot 1/2 this round can land in slot 3 ("Matches your taste") or slot 4 ("Something new") — and Phase 4's hydration then renders it with 👍 pre-selected under a "new" label. Realistic collision: slot 3 pins the user's top affinity cuisine, the same corpus their likes came from; a 20-result random sample vs a growing like set collides regularly (≈1 in 5 sets at 10 likes). PRD Secondary criterion says slot 3 "proposes something new".
- **Fix ⭐ Recommended**: Exclude all *rated* ids (likes ∪ dislikes) from pool candidacy for slots 3/4 and backfill; dislikes stay excluded absolutely (FR-009). `getRecentLikes` drops its `limit` (MVP cardinality is small) so the full like set doubles as the exclusion list. Consequence: `ratingVerdict` becomes fully determined by slot construction (by-id-filled slots 1/2 = 'like', everything else null), so `getVerdictMap` is dropped — one less query, one less export.
  - Strength: Restores slot-3/4 "new" semantics; removes a DB round trip; verdict derivation is provably consistent with construction.
  - Tradeoff: A power user could thin the 40-candidate pool; "up to 4" (PRD-sanctioned) covers the pathological case.
  - Confidence: HIGH — cold-start route serves only 0-like users, so nothing there needs verdict hydration either.
  - Blind spot: None significant at MVP cardinality; revisit `getRecentLikes` unboundedness if like counts grow large.
- **Decision**: FIXED (recommended fix applied)

### F3 — No reliable personalized-vs-cold-start signal for the UI

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 §2 (badge contract) + Phase 3 (envelope)
- **Detail**: Phase 4 defers the mode question to implementation with a flawed heuristic ("personalized sets identified by any `ratingVerdict`") — a personalized set whose by-id calls both failed carries all-null verdicts and would misclassify as cold-start; under F2's fix, slots 3/4 are always null. Also unstated: where cold-start items' `slot` values come from, and the generalized degraded copy ("couldn't be personalized") is untrue on a degraded cold-start set (single-cuisine coverage).
- **Fix**: Add set-level `mode: 'cold_start' | 'personalized'` to the Phase 3 envelope; badges render only on `mode: 'personalized'`; degraded copy keys off mode (cold-start keeps the existing single-cuisine copy); cold-start slots are positional 1..N.
- **Decision**: FIXED (recommended fix applied)

### F4 — `getStaleLikes` silently excludes never-recorded likes from slot 2

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §2 — `getStaleLikes` contract
- **Detail**: `liked_recipe_history.last_proposed_at` is NULL for likes with no `proposals` rows (the plan's own Key Discovery: ownership-free ratings and `recorded:false` gaps). The speced filter `last_proposed_at < cutoff` drops NULLs in SQL/PostgREST, so those likes can never qualify for slot 2 — even though "not proposed in ≥2 weeks" is literally true for them.
- **Fix**: State the NULL rule: NULL counts as maximally stale — filter `last_proposed_at < cutoff OR last_proposed_at IS NULL`, ordered NULLs first.
- **Decision**: FIXED (recommended fix applied)

### F5 — `cuisine_affinity` view cannot implement the decided tie-break

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Decided defaults (taste aggregation) vs Phase 1 §1 (view contract)
- **Detail**: Decided defaults: "ties broken by most recent event". The view exposes only `(user_id, requested_cuisine, like_events)` and `getTopCuisine` orders by `like_events DESC` with "tie-break handled deterministically" — no recency column exists to implement the decided rule. Internal contradiction the implementer would hit mid-migration.
- **Fix**: Add `last_event_at = max(proposed_at)` to the view; `getTopCuisine` orders `like_events DESC, last_event_at DESC`.
- **Decision**: FIXED (recommended fix applied)

### F6 — `requestedCuisine` type ripple unstated (`string` → `string | null`)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2/3 contracts
- **Detail**: By-id slots have no pinned cuisine and Phase 3 specs `requested_cuisine: null` persistence — but `ProposedRecipe.requestedCuisine: string`, `toProposed(recipes, requestedCuisine: string)`, and the wire `ProposalPayload.requestedCuisine: string` all require a string. The plan never states the widening. Verified safe: no UI or test reads the field; only `persist()` maps it through.
- **Fix**: State explicitly that both types widen to `string | null` and `toProposed` accepts null.
- **Decision**: FIXED (recommended fix applied)

### F7 — Phase 2 "(none)" manual bullet trips the bullet↔checkbox mapping

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Manual Verification
- **Detail**: The Progress section itself is well-formed (Phase 2 correctly omits its empty Manual subsection per progress-format.md). But the phase body's `#### Manual Verification:` holds a placeholder bullet "- (none — …)" with no Progress counterpart — harmless to `/10x-implement`'s parser (which reads only Progress), yet it trips the mechanical every-bullet-has-a-checkbox check.
- **Fix**: Reword the placeholder as plain italic text (no `- ` bullet).
- **Decision**: FIXED (recommended fix applied)

## Triage Summary

- Fixed: F1, F2, F3, F4, F5, F6, F7 (all via recommended fix, per user directive)
- Skipped / Accepted / Dismissed: none
- Verdict after fixes: **SOUND**
