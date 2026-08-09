<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Manage Rated Recipes (S-04)

- **Plan**: context/changes/manage-rated-recipes/plan.md
- **Scope**: Phase 3 of 3 (full plan)
- **Date**: 2026-08-09
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Plan drift: 14/14 planned items MATCH, 0 DRIFT, 0 MISSING, 0 EXTRA. All "NOT doing" guardrails respected. Automated criteria re-verified at review time: lint clean, 66/66 tests pass, build completes. Manual criteria are all checked in Progress with commit SHAs; the deploy-sequence items (1.4–1.6) are human attestations with no diff-observable evidence, accepted as such.

## Findings

### F1 — Missing service-role key silently breaks the rating loop for fresh recipes

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/proposals.ts:176-181
- **Detail**: With `SUPABASE_SERVICE_ROLE_KEY` unset (it is `optional: true` in astro.config.mjs), `persist()` returns `recorded: false` and fresh recipes never land in `recipes` — so every later `POST /api/ratings` on them FK-404s `unknown_recipe`. The core rate loop breaks for all newly proposed recipes with a single generic console line as the only trace.
- **Fix ⭐ Recommended**: Keep the plan's user-confirmed tolerant `recorded:false` envelope, but make the log name the downstream consequence explicitly so the misconfiguration is unmissable in Workers logs.
  - Strength: Addresses the actual defect (silence) without overturning the plan's user-confirmed degrade decision or breaking secret-less builds.
  - Tradeoff: Behavior still degrades rather than failing the request; detection relies on log review.
  - Confidence: HIGH — one-line change, matches the existing sanitized-console posture.
  - Blind spot: The stricter alternative (return `service_unavailable` when the key is missing in production, or make the env required) reverses a user-confirmed plan decision, so it is deliberately not applied autonomously.
- **Decision**: FIXED — consequence-naming console.error at src/pages/api/proposals.ts:179 (envelope unchanged per plan decision)

### F2 — Hardening has no retroactive audit of pre-hardening `recipes` rows or grant-layer residue

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260809180000_manage_rated_recipes.sql:27-29
- **Detail**: The migration closes future writes (policy dropped, insert revoked), but a row spoofed under the old `with check (true)` policy is only repaired if the recipe re-enters a proposal set. A spoofed title/image never re-proposed persists indefinitely — and S-04 is the first surface rendering stored rows back to users. Separately, Supabase default privileges may leave `anon`/`authenticated` grants on the table that RLS currently neutralizes but that are worth confirming.
- **Fix ⭐ Recommended**: Queue a human-run one-time audit (SQL provided in follow-ups/review-fixes.md): flag `recipes` rows whose image host is not `img.spoonacular.com`, and list residual grants for `anon`/`authenticated` on `public.recipes`.
  - Strength: Zero code churn and zero quota cost; effective closure already holds via RLS, so an audit (not a repair migration) is proportionate.
  - Tradeoff: Relies on the human actually running it; heuristic can miss a spoofed title with a legit image host.
  - Confidence: HIGH — solo-MVP user base makes pre-hardening spoofing unlikely; audit confirms rather than assumes.
  - Blind spot: No `created_at` on `recipes`, so pre/post-hardening rows can't be distinguished directly.
- **Decision**: FIXED — audit queued with ready-to-run SQL in follow-ups/review-fixes.md (human execution pending)

### F3 — DB-stored image URLs rendered without the http(s) protocol screen

- **Severity**: ⚪ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/ratings/RatedRecipesList.tsx:158 (and src/components/proposals/RecipeCard.tsx:97)
- **Detail**: `safeUrl()` guards link URLs in RecipeCard but neither card screens `image` before `<img src>`. No script-execution risk, but a pre-hardening spoofed row could carry an arbitrary URL (tracking pixel / referrer leak). The ratings page is the first surface rendering historically-spoofable stored values.
- **Fix**: Extract `safeUrl` to `src/lib/safe-url.ts` and apply it to image URLs in both cards (non-http(s) → gradient fallback).
- **Decision**: FIXED — shared guard in src/lib/safe-url.ts; both cards screen `image` before `<img src>`

### F4 — Two-step delete's `onBlur` disarm rarely fires as documented

- **Severity**: ⚪ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/ratings/RatedRecipesList.tsx:194-207
- **Detail**: Arming replaces the trash button with a different button element, so focus falls to `body` and the confirm button never holds focus — clicking elsewhere does not disarm. Conversely, disabling the focused confirm button during delete fires blur and disarms mid-flight (cosmetic flicker). No data-safety hole (confirm still requires an explicit click), just weaker than the comment claims.
- **Fix**: `autoFocus` the confirm button when armed (blur-to-disarm then works as documented) and skip the disarm while the delete is in flight.
- **Decision**: FIXED — autoFocus on the armed confirm button + in-flight guard on the onBlur disarm

### F5 — `.limit(100)` comment undersells a functional cap on FR-005/006/007

- **Severity**: ⚪ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/history.ts:126-129
- **Detail**: The comment calls the limit "a display bound, not a correctness rule", but a user with >100 ratings can never see, flip, or delete rows 101+ from the management UI — the bound is functional, not cosmetic. Acceptable at MVP cardinality.
- **Fix**: Amend the comment to state that ratings past the first 100 are unreachable from this UI until pagination exists.
- **Decision**: FIXED — comment now names the functional cap on FR-005/006/007

### F6 — No component tests for the ratings island

- **Severity**: ⚪ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/components/ratings/RatedRecipesList.tsx
- **Detail**: Flip, two-step delete, and error states are untested at the component level. The repo has no island tests anywhere, so this is repo-wide posture, not a regression; the E2E test plan (which this slice unblocks) is the designated coverage vehicle.
- **Fix**: Accept — consistent repo posture; browser-level coverage arrives via the phased E2E rollout.
- **Decision**: ACCEPTED — repo-wide posture; the phased E2E rollout (unblocked by this slice) is the coverage vehicle
