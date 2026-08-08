<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Cold-start Proposals Implementation Plan

- **Plan**: context/changes/cold-start-proposals/plan.md
- **Mode**: Deep
- **Date**: 2026-07-20
- **Verdict**: REVISE -> SOUND after triage (all 6 findings resolved 2026-07-20)
- **Findings**: 0 critical, 4 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

10/10 existing paths ✓ (all 4 new files correctly absent, `supabase/migrations/` correctly absent) · symbols ✓ (`toCandidate` :51-61 blind-casts as claimed, `searchRecipes` :110-122 clamps offset & has no `type` param, `PROTECTED_ROUTES` middleware.ts:4, `createClient` supabase.ts:5, callback.ts:14-43 template, both ESLint rules confirmed as errors; two trivial line-ref drifts: react-compiler rule is at eslint.config.js:58 not :52, and Welcome.astro:57 is `sm:grid-cols-3` not the quoted `sm:grid-cols-2`) · brief↔plan ✓ · Progress↔Phase contract ✓ (all 5 phases matched, all 27 criteria mirrored, no checkboxes outside Progress) · contract-surfaces: all 5 surfaces checked, plan conforms (but see F2 — the registry's own 2.71 row goes stale under this plan).

## Findings

### F1 — Random offset can overshoot a cuisine's corpus

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2.4 (proposal set assembly) / Implementation Approach
- **Detail**: Each call gets "an independent random offset" drawn from 0–900. The 900 bound is the provider's cap, not evidence of corpus depth: the spike verified the six cuisines return full results only at `number=10` with default offset (findings §5); per-cuisine `totalResults` was never measured. If a cuisine's corpus is smaller than the drawn offset, that call returns 0 results while still costing its 1-point base — a randomly recurring failure that silently halves (or, if both overshoot, empties) the set and wastes quota.
- **Fix A ⭐ Recommended**: Cap the random offset to a small spike-safe range (e.g. 0–50) and let `sort=random` carry most of the variety.
  - Strength: Keeps both PRD variety axes with zero overshoot risk at any depth the spike actually verified.
  - Tradeoff: Narrower addressable window until per-cuisine `totalResults` is measured (the response carries it; one dev call per cuisine would establish real bounds).
  - Confidence: HIGH on safety, MEDIUM on variety — whether `sort=random` alone varies enough between calls is unmeasured.
  - Blind spot: Spoonacular's `sort=random` reshuffle behavior across identical repeated calls is undocumented.
- **Fix B**: Drop the offset axis entirely; rely on `sort=random` alone.
  - Strength: Simplest possible; no magic bound to justify.
  - Tradeoff: Deviates from the PRD Business Logic sentence that names both axes; single randomness source.
  - Confidence: MEDIUM — same unmeasured reshuffle question.
  - Blind spot: Same as Fix A.
- **Decision**: Fixed via Fix A (offset capped to 0-50)

### F2 — Quota figures contradict the plan's own number=20 spec

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Current State (:20), Implementation Approach (:56), Phase 5 (:362, :376, criterion 5.6), Performance Considerations (:409)
- **Detail**: The measured 2.71 points/set (spike M2) was for 2 calls at `number=10`. The plan mandates `number=20` per call, which predicts 2 + 40×0.035 = **3.40 points** (~14 sets/day, not ~18). Success criterion 5.6 ("≈2.71") cannot pass — a correct implementation would read as "extra calls leaked in" and could prompt a wrong fix (dropping to number=10, breaking findings §3 binding rule 2). The ":56" phrasing also mixes units: 0.70 is one call's over-fetch against a 2.00 two-call floor; the total over-fetch is 1.40.
- **Fix**: Recompute to ≈3.40 points / ~14 sets/day at :20, :56, :362, :376, :409 and criterion 5.6; add a note that the 2.71 rows in `docs/reference/contract-surfaces.md` and plan-brief.md describe the number=10 shape.
- **Decision**: Fixed

### F3 — Single-cuisine degradation signal is dropped at the endpoint

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2.4 vs Phase 3.1 vs Phase 4
- **Detail**: Phase 2 requires `buildColdStartSet` to "signal the degradation to the caller so the UI can note it" when one call fails, but the Phase 3 envelope is exactly `{ ok, proposals, recorded }` — no degradation field — and no Phase 4 component mentions rendering the note. The implementer must invent the field name and the UI treatment mid-build.
- **Fix**: Add `degraded: boolean` (or `cuisines: string[]`) to the success envelope in Phase 3.1 and one line in the ProposalList contract for the degraded-set note.
- **Decision**: Fixed

### F4 — `db push --linked` listed as Automated crosses the human-only production boundary

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Success Criteria
- **Detail**: Criteria 1.2/1.3 (`npx supabase db push --dry-run --linked` / `db push --linked`) sit under **Automated Verification**, which `/10x-implement` treats as agent-run commands. The plan's own Implementation Note declares production schema changes human-only (per deployment-plan.md), and the linked project is production — there is no staging project. The pause note gates Phase 2, but the push itself is inside Phase 1's automated list, so an implementing agent would run it before ever reaching the pause.
- **Fix**: Move 1.2 and 1.3 to Manual Verification annotated "human-run"; the agent's automated criteria stop at migration-file-exists + lint.
- **Decision**: Fixed

### F5 — Shared `recipes` catalogue is writable by any authenticated user; first write wins

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1.2 — RLS policies
- **Detail**: `recipes` grants insert `with check (true)` to `authenticated`, registration is open, and the anon key is public. Any account holder can pre-insert a `spoonacular_id` with an arbitrary title or image URL directly via PostgREST; the app's later genuine upsert (`ignoreDuplicates: true`) is then silently discarded, and with no update policy nothing can repair the row. Impact is content spoofing in a shared table that other users will see from S-03's history view onward — low stakes for a flat-trust MVP, but structural.
- **Fix**: Accept for MVP and record as a lesson (`/10x-lesson`); revisit the write path (service-role writes or a trigger-side validation) when S-03 starts rendering `recipes` rows back to users.
- **Decision**: ACCEPTED - recorded in context/foundation/lessons.md

### F6 — Behavior when fewer than 4 survivors is undefined

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2.4 / Phase 4
- **Detail**: The edge cases all end "set still reaches 4", but the path where it doesn't (thin or heavily overlapping results, or a surviving cuisine yielding <4 after validation drops) is unspecified: the envelope shape for 1–3 proposals, interleave order when cuisines are unbalanced, and the UI state for an ok-but-empty set are all guesses. PRD says "up to 4", so returning fewer is legitimate — the plan just needs to say so.
- **Fix**: One line in the Phase 2 contract — return whatever survives (0–4), best-effort interleave — plus: UI renders the count received, and an ok-but-empty set shows the provider-error message rather than a blank grid.
- **Decision**: Fixed
