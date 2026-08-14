# Extract the compliance barrier from the slot engine (C4) — Plan Brief

> Full plan: `context/changes/refactor-opportunities/plan.md`
> Research: `context/changes/refactor-opportunities/research.md`

## What & Why

`src/lib/proposals.ts` holds two unrelated concerns in one 480-line file: a ~175-line content-policy barrier that sanitizes provider HTML into a compliant excerpt, and the FR-008 slot engine. This plan splits them and then covers the barrier with tests. It is the #1-ranked refactor opportunity in the research — the highest debt cost in the repo relative to the cost of fixing it.

The barrier is the **only** mechanism defending two hard constraints (PRD Non-Goals "no macro or nutritional data"; the NFR requiring markup stripping and no third-party anchors), and it has **zero** test coverage. The collocation is the direct cause: testing it today means routing input through the slot engine's fixtures instead of calling a function with a string.

## Starting Point

Lines `:67-241` of `src/lib/proposals.ts` are contiguous and self-contained — three compliance regexes, a 45-entry entity table, two length constants, and seven private helpers behind one exported function. They join the engine at exactly one seam: `excerpt: sanitizeSummary(recipe.summary)` at `:258`.

Verified mechanically: `sanitizeSummary` appears exactly twice in the whole repo (declaration and call), no test file references it or `excerpt`, and no symbol from the block is referenced anywhere outside `src/lib/proposals.ts`.

## Desired End State

`src/lib/sanitize-summary.ts` exists as a single-responsibility module exporting one symbol. `src/lib/proposals.ts` is ~175 lines shorter and is the slot engine alone. `src/lib/__tests__/sanitize-summary.test.ts` pins the compliance guarantees as plain input/output assertions, so a future widening of the known-incomplete filter set is cheap and safe.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Scope of the change | C4 only — not C1 or C3 | Best cost/benefit ratio of the three ranked items and the only one with zero test-file impact. | Plan |
| Include tests? | Yes — extract first, then test | Zero coverage on the repo's only compliance guard is the core reason C4 ranks #1; the extraction is what makes those tests writable. | Plan |
| Module name & surface | `src/lib/sanitize-summary.ts`, one export | Keeps the seam one function wide and preserves current encapsulation exactly. | Plan / Research §5 |
| Verification | build + lint + full local suite | CI runs no tests, so the local suite plus the compiler is the strongest guard available. | Research §4 |
| Re-widen the filter patterns? | No — deferred | Needs fresh provider payload samples, which spends quota and adds an external dependency to the plan. | Plan |
| Fix defects found by new tests? | No — record as findings | Keeps Phase 1 behavior-neutral so any Phase 2 finding is attributable. | Plan |

## Scope

**In scope:**
- Move `src/lib/proposals.ts:67-241` verbatim into `src/lib/sanitize-summary.ts`
- Import it back at the single seam in `toProposed`
- New test file covering compliance, entity decoding, text shaping, and null paths

**Out of scope:**
- C1 (envelope typing) and C3 (orchestration node)
- Widening `NUTRITION_CLAIM` / `ENTITIES`
- Any behavior change, including fixing defects the new tests reveal
- Exporting the private helpers; renaming to a policy-flavored module name
- Vitest coverage config, jsdom/RTL, CI workflow edits

## Architecture / Approach

A contiguous block moves out; one import comes back. `sanitize-summary.ts` has no imports of its own — the block depends on nothing outside itself — so the dependency edge is strictly one-directional: engine → policy. `ProposedRecipe.excerpt` and every wire contract are untouched, so no consumer sees a delta.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Verbatim extraction | New module + slimmer engine, zero behavior change | An accidental edit during the move that the type checker cannot see (regex/string behavior) |
| 2. Cover the barrier | Test file pinning compliance and text shaping | Writing mirror tests that restate constants, or locking the known-incomplete pattern set shut |

**Prerequisites:** None — no new dependencies, no config change, no provider calls, no quota spend.
**Estimated effort:** ~1–2 sessions; Phase 1 is a single small commit, Phase 2 is the larger half.

## Open Risks & Assumptions

- The move is assumed behavior-neutral, but regex and string behavior is invisible to the type checker — the unchanged existing suite is the only Phase 1 evidence, and it never exercises `sanitizeSummary` directly.
- Phase 2 may reveal that current behavior is already wrong somewhere; by design that becomes a recorded finding, so this change can close with a known defect logged.
- `lessons.md` records the nutrition-claim filter as permanently incomplete — the tests reduce the cost of widening it but do not close the gap.
- Tests are not enforced in CI (only `.husky/pre-push`), so the new coverage protects local work and review, not the pipeline.

## Success Criteria (Summary)

- `src/lib/proposals.ts` contains only the FR-008 slot engine; the policy block lives in its own module with one export.
- `npm run lint`, `npm run build`, and `npm test` all pass, with `proposals.test.ts` unmodified and still green.
- The compliance guarantees — no macro figures, no nutrition claims, no provider backlink, no markup — are pinned by assertions that survive a future widening of the pattern set.
