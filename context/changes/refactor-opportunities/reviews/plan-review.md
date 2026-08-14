<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Extract the compliance barrier from the slot engine (C4)

- **Plan**: `context/changes/refactor-opportunities/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-11
- **Verdict**: REVISE → SOUND (all findings fixed in triage)
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

7/7 paths ✓, 14/14 symbols ✓, brief↔plan ✓. Verified independently: block `:67-241` contiguous and self-contained (all 14 block-private symbols grep to `src/lib/proposals.ts` only); engine constants at `:58,59,65` above the cut; `sanitizeSummary` has exactly 2 repo hits (`:211`, `:258`); `kebab-case` module name matches `safe-url.ts` / `supabase-admin.ts`; Progress↔Phase contract well-formed. Contract-surface hit: **Summary display rule** (`docs/reference/contract-surfaces.md`) — plan honors it; the surface names no file path, so the move does not stale it.

## Findings

### F1 — Phase 1 has no evidence of behavior neutrality

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Success Criteria (1.3, 1.4, 1.6)
- **Detail**: Phase 1 claims a verbatim move with no behavior delta, evidenced by `npm run build` + `npm test`. Neither can see it: no test exercises `sanitizeSummary` (`src/pages/api/__tests__/proposals.test.ts:62` hardcodes `excerpt: null`; `src/lib/__tests__/proposals.test.ts` never touches it). A mangled regex passes all five automated criteria. The only guard was a human eyeballing the diff, and the plan pauses before Phase 2's tests land, so the unverified commit stands alone.
- **Fix**: Byte-identity `diff` of the moved slice against `git show HEAD:src/lib/proposals.ts | sed -n '67,241p'`, added as an automated Phase 1 criterion and Progress step 1.6.
- **Decision**: FIXED

### F2 — Revealed compliance defects park in free-form Notes

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: What We're NOT Doing (bullet 3) · Phase 2 criterion 2.7
- **Detail**: `lessons.md` ("Never close a compliance slice guarded only by a test") requires a deferred follow-on to be "a named step in `## Progress`, not a line in §What We're NOT Doing." The plan used exactly that shape and routed findings to `change.md`'s free-form Notes stub, which no downstream skill reads — so the change could close with a live no-macros non-goal breach that nothing tracks.
- **Fix A ⭐ Recommended**: Route each revealed defect to a named follow-up (`/10x-new` change folder, or a `lessons.md` rule for a new class of gap), linked from `change.md` Notes; the change may not close while a finding lacks one.
  - Strength: Matches the lessons.md rule verbatim; cheap.
  - Tradeoff: Small ceremony step at the end of Phase 2.
  - Confidence: HIGH — accepted repo lesson naming this exact anti-shape.
  - Blind spot: If no defect surfaces, the step is inert.
- **Fix B**: Allow in-plan fixes for compliance-class defects only.
  - Strength: No defect outlives the change.
  - Tradeoff: Breaks the behavior-neutral Phase 1 that makes Phase 2 findings attributable; Phase 2 can grow unboundedly.
  - Confidence: MEDIUM.
- **Decision**: FIXED via Fix A

### F3 — The move stales lessons.md's own pointer

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Changes Required
- **Detail**: The known-incomplete lesson cites `src/lib/proposals.ts:34-43` (already stale — the regexes sit at `:71-85`) and "Applies to: `sanitizeSummary` in `src/lib/proposals.ts`". Phase 1 breaks the file reference too. The new module cites `lessons.md`, but `lessons.md` would keep pointing at the old home — and that entry is re-read at start by `/10x-plan`, `/10x-plan-review`, and `/10x-implement`.
- **Fix**: Phase 1 change #3 repoints the entry's Context and Applies-to to `src/lib/sanitize-summary.ts`, dropping the stale line range; rule text unchanged. Progress step 1.10.
- **Decision**: FIXED

### F4 — The most recently added claim branch is untested

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Contract, "Compliance — nutrition claims"
- **Detail**: `NUTRITION_CLAIM` has seven alternation branches; Phase 2 enumerated four and omitted the bare-word tail `\bhealthy\b|\bdiet\b|\bcalorie|\bnutrition` — per `lessons.md`, exactly the widening added after the original set missed "super healthy" and "gluten free diet". The branch that exists because of a past incident had no pin under it.
- **Fix**: Extend the nutrition-claims assertion group so every alternation branch has at least one pinning case, including `super healthy` / `diet` / `calorie` / `nutrition` and the `low in` / `rich in` / `dairy-free` variants.
- **Decision**: FIXED
