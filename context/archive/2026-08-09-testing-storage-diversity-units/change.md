---
change_id: testing-storage-diversity-units
title: Testing storage diversity units
status: archived
created: 2026-08-09
updated: 2026-08-15
archived_at: 2026-08-15T15:04:18Z
---

## Notes

Second and final slice of rollout **Phase 1** in `context/foundation/test-plan.md`
("Harness + proposal-engine units"). Risk #1 shipped earlier as
`context/changes/testing-harness-proposal-units/`; this change closes **#4** and **#5**.

**Risks covered (from test-plan.md §2):**

- **#4** — the app persists a recipe field beyond id/title/image (or the response's
  `cuisines[]`/`dishTypes[]`), breaching Spoonacular storage terms. High impact.
- **#5** — cold-start proposals return fewer than 2 cuisines because diversity is read
  from the response's often-empty `cuisines[]` instead of the pinned request-side cuisine.

**Response intent (test-plan.md §2 Risk Response Guidance):**

- **#4** — prove the only recipe fields written to the DB are id, title, image URL, plus
  the app's *own* request facets (requested cuisine/type, proposed-at timestamp). Must
  challenge: "requested cuisine is a provider recipe field" — it is not; the app's own
  request data is legal to store, the response's `cuisines[]` is the forbidden one.
  Anti-pattern: snapshotting the whole provider object and asserting it round-trips.
- **#5** — prove a cold-start set spans ≥2 distinct cuisines counted from what the app
  *requested and recorded*, not the response body. Must challenge: "the response says 2
  cuisines, so we're fine." Anti-pattern: using a fixture where `cuisines[]` happens to
  be populated.

**Layer:** unit. The Vitest node-environment harness is already wired — see
`test-plan.md` §6.1 for the interception patterns and the oracle rule (assert PRD
constants, never import the code's own constants).

**Scoping caveat:** the persist path changed after the test plan was written
(`personalized-proposal-slots`, `rate-recipe`, `manage-rated-recipes` all landed).
Treat the current schema and upsert path as the subject, not the 2026-07-22 snapshot.

**Closed 2026-08-15:** risks #4 and #5 shipped; rollout Phase 1 is now closed in
`test-plan.md` §3. Two follow-ons this slice deliberately did not take: the `Pick<>`
typed row helper (A6) and risk #7 / the migration schema assertion (rollout Phase 3).
This plan's `## Progress` remains the per-step execution ledger.

**Impl-reviewed 2026-08-15** (`reviews/impl-review.md`): all 11 mutation checks were run
during the review — 10 reddened, one (2.14, dedupe by `spoonacular_id`) stayed green because
the fixture used distinct ids. Fixed with a repeated-id sibling test; **11/11 now redden** and
all 15 Manual boxes are ticked. Status moved back from `complete` to `impl_reviewed` because
the review opened **Phase 4** in `## Progress`: the `Pick<>` FR-011 narrowing (A6) is now a
named, tracked step rather than a §What-We're-NOT-Doing line, per the lessons.md rule
"Never close a compliance slice guarded only by a test". Deferred, not taken: the
`.dependency-cruiser.cjs` lint failure (pre-existing; `npm run lint` exits 1) needs its own
housekeeping change.
