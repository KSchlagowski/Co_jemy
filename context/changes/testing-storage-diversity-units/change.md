---
change_id: testing-storage-diversity-units
title: Testing storage diversity units
status: complete
created: 2026-08-09
updated: 2026-08-10
archived_at: null
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

---

## Outcome (2026-08-10)

Risks **#4** and **#5** shipped, closing rollout **Phase 1** — all three of its risks
(#1, #4, #5) now have runnable unit gates. Suite went 66 → 77 tests.

All eleven mutation checks were executed, not just asserted: each broke the invariant in
production code, reddened its test, and was restored. One correction to the plan — Phase 2's
mutation check 2.14 ("dedupe the `proposals` insert rows by `spoonacular_id`") is
**behaviourally inert**: `interleave()` already dedupes by id, so every real set has distinct
ids and the mutation changes nothing. The assertion was instead exercised by collapsing rows
on `requested_cuisine`, which reddens 4 tests including the persisted-pin one.

**Scope added during implementation.** The plan's A6 deferred the FR-011 narrowing type to
§What We're NOT Doing. `context/foundation/lessons.md` §"Never close a compliance slice
guarded only by a test" forbids exactly that, and prescribes the remedy for this case: the
type ships before the slice is marked complete, and where a mutation check forces it into a
separate commit, the follow-on is a named step in `## Progress`. Phase 4 was added on those
grounds and landed after phases 1–2 had recorded every mutation check, so A6's rationale was
satisfied rather than overridden. FR-011 is now structural at the write boundary: a spread is
`TS2741` and an added key `TS2353`, where both previously compiled.

**Deliberately not taken, and where they now live:**

- Risk #7 (`recipes` world-readable via `using (true)`) — rollout Phase 3, already in its row.
- The migration-column assertion (A3) — rollout Phase 3, now named in §3's Phase 3 row as
  `#4 (schema-column half)` rather than buried in this folder.
- A key-set assertion on `toPayload` (the wire projection) — risk #6, rollout Phase 2.
- CI enforcement of `npm test` — rollout Phase 4. §5's unit-gate row now says so explicitly,
  so Phase 1 `complete` does not silently claim an enforcement that does not exist.

This plan's `## Progress` remains the per-step execution ledger.
