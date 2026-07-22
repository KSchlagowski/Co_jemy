---
change_id: testing-harness-proposal-units
title: Harness + proposal-engine units (test rollout Phase 1)
status: implementing
created: 2026-07-22
updated: 2026-07-22
archived_at: null
---

## Notes

Test-plan **Phase 1** — see `context/foundation/test-plan.md` §3 (row 1). Bootstrap the
test runner and defend the cheapest-layer proposal-engine risks with unit tests.

- **Risks covered:** #1 (quota / call-count budget), #4 (storage-field discipline), #5 (request-side cuisine diversity) — `test-plan.md` §2 Risk Map.
- **This research pass scopes risk #1 only** (quota budget / provider-call count). Risks #4 and #5 get their own research when their sub-phases open.
- **Layer:** unit (per §2 Risk Response Guidance, risk #1 "Likely cheapest layer" = unit).
- **Prerequisites:** the shipped cold-start engine (`context/changes/cold-start-proposals/`) and the F-01 cost spike (`context/archive/2026-07-16-spoonacular-retrieval-spike/`).
- **Runner state at open:** no test infrastructure exists yet — no Vitest/MSW/`@testing-library`, no `test` script, no `*.test.ts`. Bootstrapping the runner is part of this phase.
