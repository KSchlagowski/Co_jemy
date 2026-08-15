<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Storage-Field Discipline (#4) + Request-Side Cuisine Diversity (#5)

- **Plan**: context/changes/testing-storage-diversity-units/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-08-15
- **Verdict**: NEEDS ATTENTION → **all findings triaged and resolved 2026-08-15**
- **Findings**: 0 critical, 3 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | WARNING |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Evidence gathered

- `npm test` → **77 passed** (66 pre-existing + 11 new), stable across **5 consecutive runs**
  (~150 effective iterations of the unseeded ~30× loops). No flakiness observed.
- `npm run astro sync && npm run lint` → 1 error, **pre-existing** (`.dependency-cruiser.cjs`
  parser error, last touched in `bcf944f`, outside this change). No new lint errors.
- Diff touches **6 files, all planned**; `git diff --name-only 64b37a7..HEAD -- src/` returns
  only `__tests__` files → **A6 (no production code change) confirmed**.
- Oracle rule verified: the three test files import only functions/types from `src/`, no
  constants. The `CUISINES` import was removed from `src/lib/__tests__/proposals.test.ts`.
- No `eslint-disable`, `as unknown as`, or `@ts-` suppressions added anywhere in the diff.
- All 15 planned "Changes Required" verified present and matching contract (one trivial
  placement drift: Phase 2 change #6 landed in the `slot activation thresholds` describe
  rather than the steady-state describe — same `beforeEach`, no behavioural difference).

### Mutation checks — run during this review (the plan left all 11 unchecked)

| # | Mutation | Result |
|---|---|---|
| 1.7 | `{ ...p }` in the `recipes` upsert map | ✅ RED (1 failed) |
| 1.8 | `summary: p.summary` added to upsert row | ✅ RED (1 failed) |
| 1.9 | Extra key on the `proposals` insert row | ✅ RED (1 failed) |
| 1.10 | Hard-code `requested_cuisine: "thai"` | ✅ RED (3 failed) |
| 1.11 | `cuisines: raw.cuisines` in `toCandidate` | ✅ RED (2 failed) |
| 2.9 | Both groups pinned to `cuisineA` | ✅ RED (2 failed) |
| 2.10 | Hard-code `degraded: false` | ✅ RED (3 failed) |
| 2.11 | `cuisines?.[0] ?? requestedCuisine` at `:335` | ✅ RED (1 failed) |
| 2.12 | `fromById` sources cuisine from response body | ✅ RED (1 failed) |
| 2.13 | Add `"american"` to `CUISINES` | ✅ RED (2 failed) |
| 2.14 | Dedupe `proposals` insert rows by `spoonacular_id` | ❌ **STAYED GREEN (77/77)** |

10 of 11 mutations redden. The one survivor is F1 below. All source files restored
(`git status` clean).

## Findings

### F1 — The persisted-pin test cannot catch the dedupe mutation the plan named

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/pages/api/__tests__/proposals.test.ts:348-360
- **Detail**: Plan Phase 2 manual check 2.14 states that deduping the `proposals` insert rows
  by `spoonacular_id` must redden the persisted-pin test. It does not — I applied the mutation
  (`[...new Map(proposals.map((p) => [p.id, p])).values()].map(...)` in `persist()`) and the
  full suite stayed green at 77/77. The cause is the fixture: `proposed(1,…), proposed(2,…),
  proposed(3,…), proposed(4,…)` carry four **distinct** ids, so an id-keyed dedupe is a no-op
  and `expect(rows).toHaveLength(4)` cannot fail. The test does catch a *cuisine*-keyed
  collapse (which is what its inline comment describes), so it is not decorative — but the
  specific regression the plan promised to gate is ungated. This is precisely the
  "a clean fixture cannot fail" trap the slice was written to eliminate, surviving inside the
  slice itself.
- **Fix**: Add a second `it` (or extend the fixture) where two proposals share a
  `spoonacular_id` — e.g. `[proposed(1, "italian"), proposed(1, "mexican"), proposed(2,
  "italian")]` — and assert `rows` still has one entry per proposal. Then re-run mutation 2.14
  to confirm it reddens.
  - Strength: Restores the exact guarantee the plan's Contract claims ("one row per proposal,
    no dedupe or collapse"); costs one small `it` block in a file that already owns the seam.
  - Tradeoff: None material — additive test, no production change, no new fixture machinery.
  - Confidence: HIGH — I ran the mutation and observed it survive, and the distinct-id fixture
    fully explains why.
  - Blind spot: Whether the engine can actually emit a duplicate id in one set is unverified;
    if it structurally cannot, the assertion is defence-in-depth rather than a live risk.
- **Decision**: **FIXED** — added the sibling `it` "cold start: a repeated spoonacular_id still
  writes one proposals row per proposal (risk #5)" at
  `src/pages/api/__tests__/proposals.test.ts:367`, using `[proposed(1,"italian"),
  proposed(1,"mexican"), proposed(2,"italian")]`. Re-ran mutation 2.14: suite now goes **red**
  (1 failed / 78). The existing distinct-id test was left untouched. Framed in-comment as
  defence-in-depth, since the engine dedupes by id upstream.

### F2 — Change closed as `complete` with all 15 manual-verification steps unchecked

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: context/changes/testing-storage-diversity-units/plan.md:740-744, 761-766, 776-779
- **Detail**: Every Automated Progress box is `[x]`, but all 15 Manual boxes (1.7–1.11,
  2.9–2.14, 3.2–3.5) remain `[ ]`, while `change.md` is stamped `status: complete` and
  test-plan §3 Phase 1 is flipped to `complete`. The plan's own Implementation Notes for
  Phases 1 and 2 required a pause for human confirmation that the mutation checks redden,
  with the rationale "A storage test that cannot be made to fail is worse than no test — it
  certifies compliance it never verified." The slice was closed without that gate, and F1 is
  the concrete cost: a promised gate that does not exist shipped inside a change marked done.
- **Fix**: Check off 1.7–1.11 and 2.9–2.13 (verified red in this review, evidence table above),
  leave 2.14 unchecked pending F1's fix, and confirm the four Phase 3 reader checks (3.2–3.5 —
  I verified all four against the test-plan diff and they hold).
  - Strength: Makes the ledger match reality; the mutation evidence now exists and is recorded.
  - Tradeoff: `complete` was claimed before the evidence existed — checking the boxes now is
    honest only because the checks were actually run, not because the status was already set.
  - Confidence: HIGH — 10 of 11 mutations empirically reddened in this session.
  - Blind spot: 3.3 ("a reader can add a storage-discipline test from §6.1 alone") is a
    judgement call I can only assess as a proxy for a real first-time reader.
- **Decision**: **FIXED** — all 15 Manual boxes ticked in `plan.md`, each annotated "verified
  in impl-review". 2.14 records its original green result and the F1 fix. After F1,
  **11 of 11 mutations redden**.

### F3 — Closing this slice with the `Pick<>` narrowing deferred to §What We're NOT Doing is the exact case lessons.md forbids

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architecture
- **Location**: context/changes/testing-storage-diversity-units/plan.md:49-53, 178-180
- **Detail**: `context/foundation/lessons.md` carries an accepted rule — "Never close a
  compliance slice guarded only by a test" — whose Rule text names this situation verbatim:
  *"The narrowing type at the boundary ships before the slice is marked complete; when a
  mutation check forces it into a separate commit, the follow-on must be a named step in
  `## Progress`, not a line in §What We're NOT Doing."* Its Applies-to line names
  `impl-review` and the `recipes` upsert in `src/pages/api/proposals.ts` explicitly.
  Assumption A6 defers the `Pick<ProposedRecipe, "id" | "title" | "image">` row helper for a
  sound reason (a production change in the same commit would destroy the mutation checks) —
  but then records it under §What We're NOT Doing (`:178-180`) and closes the change, which is
  the half the rule forbids. FR-011 protection is therefore test-only and one test edit wide,
  with no named owner. Note this is a *plan-level* flaw the plan review did not catch, not
  implementer drift — the implementation followed A6 faithfully.
- **Fix A ⭐ Recommended**: Add the `Pick<>` narrowing as a named, unchecked step in this
  plan's `## Progress` (a "Phase 4: FR-011 structural narrowing" block), or open the follow-on
  change now and reference its id from `change.md`.
  - Strength: Satisfies the lesson's stated remedy exactly — the follow-on becomes a tracked
    step rather than a deliberate exclusion — without undoing A6's correct sequencing.
    The tests written here are what make the narrowing safe to do next.
  - Tradeoff: Re-opens a change that is currently stamped `complete`, or adds a second change
    folder to track.
  - Confidence: HIGH — the lesson names this file, this write site, and this exact deferral shape.
  - Blind spot: Whether the team would rather absorb the narrowing into rollout Phase 3
    alongside the deferred schema-column assertion (A3), which already has a named owner in
    test-plan §3.
- **Fix B**: Leave as-is and record an explicit exception against the lesson, noting that the
  test gate plus the §6.6 note is deemed sufficient for the MVP.
  - Strength: No churn; the slice genuinely does raise FR-011 coverage from zero to a closed
    key-set assertion at every write site.
  - Tradeoff: An accepted recurring rule is overridden silently on its first application,
    which weakens the register for every future slice that consults it.
  - Confidence: MEDIUM — defensible on stakes, weak on precedent.
  - Blind spot: How soon rollout Phase 3 actually lands; the longer the gap, the worse B ages.
- **Decision**: **FIXED via Fix A** — added a `### Phase 4: FR-011 structural narrowing
  (follow-on, not yet started)` block to `plan.md`'s `## Progress` with three unchecked steps
  (4.1 `Pick<>`-typed row helper at the upsert site; 4.2 suite still green; 4.3 `{ ...p }` no
  longer type-checks), headed by a note citing the lessons.md rule. A6's sequencing is
  preserved — the narrowing stays out of the test commits — but it is now a tracked step
  rather than a deliberate exclusion.

### F4 — The `CUISINES` mirror flaw survives in harness.test.ts

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/__tests__/harness.test.ts:19-20
- **Detail**: A5 scoped the mirror fix to the two occurrences in
  `src/lib/__tests__/proposals.test.ts` (`:87`, `:205`), and both were correctly replaced —
  mutation 2.13 reddens two tests. But `harness.test.ts:19-20` still asserts
  `expect(CUISINES).toContain(first)` against the **imported** constant, so a wholesale pool
  replacement still passes there. This is faithful to the plan, and the file is a harness
  smoke test whose whole purpose is proving the `@/` alias and `astro:env` module graph
  resolve — importing the constant is arguably the point. Recorded so it is not later
  re-discovered as an oversight of this slice.
- **Fix**: Leave as-is, or add a one-line comment at `:19` noting the import is deliberate
  (harness resolution proof) and that the diversity oracle lives in `proposals.test.ts`.
- **Decision**: **FIXED** — added the clarifying comment at `src/lib/__tests__/harness.test.ts:14-17`.
  The assertion itself is unchanged; the comment redirects a future reader to
  `VERIFIED_CUISINES` so this import is not mistaken for the diversity gate.

### F5 — `npm run lint` is not clean, for a pre-existing reason

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: .dependency-cruiser.cjs
- **Detail**: Plan step 1.6 and Manual Testing step 3 claim `npm run lint` passes clean. After
  `npm run astro sync`, lint reports exactly one error: `.dependency-cruiser.cjs was not found
  by the project service`. It is unrelated to this change (the file was last touched in
  `bcf944f`, and nothing in this diff references it), and no new lint errors come from the
  dirty-fixture idiom — so the slice's own criterion is effectively met. But `npm run lint`
  exits non-zero today, which matters because test-plan §5 lists lint as the one gate that is
  "required (already wired)" in CI.
- **Fix**: Add `.dependency-cruiser.cjs` to the tsconfig `include`, or to ESLint's
  `allowDefaultProject`, in a separate housekeeping change.
- **Decision**: **DEFERRED** (per its own recommendation) — not fixed here, to keep this a
  test-only slice. Flagged to the user as needing a housekeeping change: `npm run lint` exits
  non-zero today and it is the one gate test-plan §5 calls "required (already wired)" in CI.

### F6 — No effective type gate on test files; plan item 1.6 overclaims

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/pages/api/__tests__/proposals.test.ts:220
- **Detail**: `npx tsc --noEmit` reported `TS2339: Property 'asDesigned' does not exist on type
  '{ slot: number; ratingVerdict: string | null; }'` — an inline response-body type omitting a
  field the very next line asserts on. Verified **pre-existing**: the same shape is present in
  the file at `64b37a7`, before this change. It matters because plan step 1.6 reads "Lint incl.
  strict type-check passes on the dirty-fixture idiom", and `npm run lint` does not surface
  TS2339, nor does CI (which runs `astro build`, not `tsc` over `src/**/__tests__`). The
  dirty-fixture idiom itself is genuinely clean — but the claim rested on a gate that is not
  running over test files.
- **Fix**: Add the missing member to the inline type; consider naming `tsc --noEmit` as the
  real type gate in test-plan §5.
- **Decision**: **FIXED** — added `asDesigned: boolean` to the inline type.
  `npx tsc --noEmit` is now **clean** across the repo. The §5 gate-naming half is left to the
  user as a test-plan edit.

### F7 — Stale line reference in a new comment

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/__tests__/proposals.test.ts:474
- **Detail**: A comment added by this change read "complementing :286-290's value-level
  assertions"; those assertions had already moved to `:333-337` by the time the change landed.
- **Fix**: Replace the line-number reference with a stable name.
- **Decision**: **FIXED** — now refers to "the 'persists to both tables' test's value-level
  assertions above", which cannot go stale.

## Dismissed

- **Intermittent suite failures** (raised by the safety/pattern sub-agent: 6 of 8 consecutive
  runs failing at `spoonacular.test.ts:169`, with varying failure counts 2/3/1/1/2/2).
  **Not a flake — an artefact of this review.** The sub-agent was running the suite
  concurrently while I was applying and reverting the 11 mutation checks against
  `src/lib/spoonacular.ts` and `src/lib/proposals.ts`. Its observed failure counts match my
  mutation results exactly (M1.11 → 2 failed, M1.10 → 3, M1.7/1.8/1.9 → 1 each, M2.9/2.13 → 2),
  and `:169` is the `getRecipeById` whitelist assertion that M1.11 targets. Confirmed by 20
  clean consecutive runs (5 before triage, 15 after) with no source mutation in flight.
- **Missing closed-key-set assertion on the wire payload** (`toPayload`). Real, but **already
  recorded** by the plan under §What We're NOT Doing (`plan.md:185-193`) with a reasoned
  deferral to risk #6 / rollout Phase 2, on the grounds that the wire contract legitimately
  gains fields over time in a way FR-011's licence-fixed triple does not. Not drift.
