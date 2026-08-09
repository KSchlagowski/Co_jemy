# Storage-Field Discipline (#4) + Cuisine Diversity (#5) — Plan Brief

> Full plan: `context/changes/testing-storage-diversity-units/plan.md`
> Research: `context/changes/testing-storage-diversity-units/research.md`

## What & Why

Close the second and final slice of test-rollout Phase 1 by converting two risks into
automated regression gates at the unit layer. **#4**: the app persists a recipe field beyond
`id`/`title`/`image` (or the response's `cuisines[]`), breaching Spoonacular's storage terms —
which on a dispute forces deletion of everything ever obtained from the API. **#5**: cold-start
proposals deliver fewer than 2 cuisines, failing US-02's acceptance criterion.

## Starting Point

Research found **neither risk is currently realised** — both are correctly implemented, and
both are one small edit away from silent breach. `persist()` receives the *wide*
`ProposedRecipe[]` (carrying `summary` and `excerpt`), and the only thing keeping those out of
the database is a hand-written object literal with no type-level enforcement; the current
suite **never reads the recipes upsert's row argument at all**. On the diversity side, the
response's `cuisines[]` is structurally unreachable, but nothing asserts the *delivered* set
spans 2 cuisines — only the requests are checked.

## Desired End State

`npm test` reddens the moment someone spreads the provider object into the `recipes` upsert,
adds a column to the `proposals` insert, sources `requested_cuisine` from anything but the
pinned request param, widens `toCandidate` at the HTTP edge, ships a single-cuisine set
without flagging `degraded`, or pins a cuisine outside the six the F-01 spike verified.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Migration-SQL column assertion (research Q1) | **Excluded** — deferred to rollout Phase 3 | A column that exists persists nothing; the write site is the necessary condition, and SQL regex false-reds on formatting. | Plan (A3) |
| FR-011 allow-list placement (research Q2) | Per-file local `const` citing the PRD line | A shared helper breaks the repo's no-helper convention and re-creates the mirror-test coupling the oracle rule forbids. | Plan (A4) |
| `CUISINES` mirror test at `:87`/`:205` (research Q3) | **Fixed in scope**, declared | Hard-coding the F-01-verified six means an unverified thin cuisine — exactly what triggers #5's collapse — cannot ship silently. | Plan (A5) |
| Test layer | Unit only; extend the 3 existing files | `change.md` fixes the layer; the runner is node-env with no DB. | Research (A1/A2) |
| Production code changes | **None**, including the `Pick<>` typed row helper | Changing prod code in the same commit as its guard destroys the mutation checks that prove the test works. | Plan (A6) |
| Assertion shape | Closed key sets (`Object.keys(row).sort()`), dirty fixtures | Per-field `toBeUndefined()` is an enumeration that misses the next field; a clean fixture cannot fail. | Research |

## Scope

**In scope:** `recipes` upsert + `proposals` insert closed key sets · `requested_cuisine`
provenance (pinned value, NULL on by-id) · `toCandidate` edge whitelist for both provider
calls · delivered-set ≥2-cuisine invariant · 200-with-zero-results collapse · contradictory
`cuisines[]` · the declared `CUISINES` mirror-test fix · test-plan cookbook + status sync.

**Out of scope:** migration-SQL assertion · any production code change · risk #7 (`recipes`
world-readable) · integration/component/e2e layers, MSW, jsdom · CI gate wiring · any
quota-spending test · seeding `Math.random` · `ratings.ts` (persists no provider content).

## Architecture / Approach

Three interception layers, each already proven in this repo, matched to the tier it can
actually observe. **DB boundary** (endpoint unit) — collaborators are module-mocked, so the
test supplies the `ProposedRecipe[]` reaching `persist()` and reads the exact row literals off
`upsert`/`insert` mock calls. **HTTP edge** (edge unit) — stub global `fetch` with a dirty raw
body and assert the projected key set. **Engine** (engine unit) — mock `@/lib/spoonacular` and
assert the delivered set's `requestedCuisine` distribution and `degraded`. The two tiers of
FR-011 defence fail differently — tier 1 by a type gaining a field, tier 2 by a literal gaining
a spread — so both are asserted; neither implies the other.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Risk #4 — storage discipline | Closed key sets at the DB boundary + the HTTP-edge whitelist, all against deliberately dirty fixtures | The dirty-fixture TypeScript idiom fighting `strictTypeChecked` (fallback documented) |
| 2. Risk #5 — request-side diversity | Delivered-set ≥2-cuisine invariant, the untested zero-results collapse, contradictory-`cuisines[]` refutation, mirror-test fix | A contradictory-cuisine sentinel that collides with a real pool member would false-red ~1-in-3 |
| 3. Cookbook + status sync | §6.1 assertion-shape lessons, §6.6 note, rollout Phase 1 closed | Marking Phase 1 `complete` while a claimed risk lacks a runnable gate |

**Prerequisites:** none — the Vitest harness, `@/` alias, and `astro:env/server` stub all
landed with the risk-#1 slice; suite is green at 6 files / 66 tests / ~4.2 s.
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- The migration's column set is asserted by **no** automated test until rollout Phase 3 (A3).
  The write-site test is strictly stronger for the actual breach, but a schema drift that adds
  an unused column goes unnoticed.
- These tests pin invariants that hold today; they certify nothing about *past* rows already in
  the database. FR-011 compliance of existing data is unverified at this layer.
- The delivered-set diversity test relies on the existing `mockClear()`-not-`mockReset()`
  counter idiom to keep pinned calls returning disjoint id ranges — a reset inside the loop
  produces a spurious red, not a spurious green.

## Success Criteria (Summary)

- Every mutation check in Phases 1 and 2 goes **red** when applied and green when restored — a
  storage test that cannot be made to fail certifies compliance it never verified.
- A `{ ...p }` spread at the upsert site, or a `cuisines` field admitted at the HTTP edge, is
  caught before it reaches a commit.
- A cold-start set that collapses to one cuisine either fails the suite or is honestly reported
  to the user as `degraded`.
