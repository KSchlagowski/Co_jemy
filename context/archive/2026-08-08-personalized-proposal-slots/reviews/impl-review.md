<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Personalized 4-Slot Proposals (S-05)

- **Plan**: context/changes/personalized-proposal-slots/plan.md
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-08-09
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success criteria evidence

- `npm test`: 49/49 pass (re-run during this review)
- `npm run lint`: pass (parser warnings only)
- `npm run build`: pass (pre-existing Tailwind/`.claude/skills` scan warning, unrelated to this change)
- Migration apply (1.1): not re-run against the linked project during review (state-changing); stamped 81716b4 and both views/indexes verified present in the migration file.
- Manual items (1.4–1.5, 3.4–3.6, 4.4–4.7): all claimed `[x]`, stamped with phase SHAs. Checked in the same commit that introduced the code — consistent with a deploy-from-working-tree-then-commit workflow; unverifiable from the diff, no contrary evidence.

## Findings

### F1 — Slot badges misrepresent backfilled/inactive slots

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/proposals/ProposalList.tsx:110-116, src/lib/proposals.ts:448-450
- **Detail**: Backfilled slots keep their designed slot number (`filled[i] ??= takeFrom(backfillPool)`), and the UI renders slot-semantic badges for every card whenever `mode === "personalized"`. A user with exactly 1 like gets slots 2/3 backfilled from the random pool, yet the cards claim "Worth revisiting" / "Matches your taste" with `degraded: false` and no softening copy. A failed slot-1 by-id's pool replacement still wears "Recently liked". The payload carries no designed-vs-backfilled distinction, so the UI cannot be honest. The implementation matches the plan — the gap is in the plan (plan-review F1 made inactive backfill silent but never decided what badge a backfilled slot wears).
- **Fix A ⭐ Recommended**: Carry per-item provenance (e.g. `asDesigned: boolean` or a nullable slot label) from `buildPersonalizedSet` through `ProposalPayload`; suppress or soften the badge when a slot was not filled as designed.
  - Strength: Makes the core value prop honest; reuses the exact payload-extension path (`slot`, `ratingVerdict`) this slice just shipped.
  - Tradeoff: Touches engine, endpoint, types, UI, and tests — a small cross-cutting change.
  - Confidence: HIGH — same extension mechanism just landed cleanly.
  - Blind spot: Mixed badged/unbadged cards in one set is a design choice not yet reviewed.
- **Fix B**: Accept for MVP and file a follow-up.
  - Strength: Zero code now; matches the ship-then-refine posture.
  - Tradeoff: The product overstates personalization in exactly the early-history window (1–4 likes) most users occupy.
  - Confidence: MED — depends how much slot honesty matters to the US-01 loop's credibility.
  - Blind spot: User-trust impact unmeasured.
- **Decision**: FIXED via Fix A — `asDesigned: boolean` carried engine → payload → UI; badges render only on `personalized && asDesigned`; inactive slot 3 counts as not-designed; cold-start payloads uniformly false; engine truth-table + endpoint passthrough tests added. 49/49 tests + lint green.

### F2 — Failure paths are fully silent (no telemetry on 500s or recorded:false)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/proposals.ts:144-149 and 166-178, src/lib/history.ts:43-45/63-65/79-81/96-98
- **Detail**: The endpoint's catch swallows all throwables with no `console.error`; `history.ts` discards the Supabase `error` object when throwing generic Errors; `persist()` drops both `recipesError` and `proposalsError`. A production 500 or a `recorded:false` run leaves zero trace in Workers observability. The secret-hygiene rationale only applies to the Spoonacular module, which already never throws — Supabase errors carry no secret.
- **Fix**: Add sanitized `console.error` markers (typed reason + Supabase `error.code`/`message`, never raw URLs) in the endpoint catch, the history.ts throws, and persist(); optionally add a typed `history_unavailable` reason so clients can distinguish history-read failure from unknown crash. Response bodies stay typed-reason-only.
- **Decision**: FIXED — sanitized `console.error` markers at the endpoint catch (apiKey query param redacted), all four history reads (Supabase `error.code`/`message`), and both persist branches; endpoint tests silence console to keep runner output clean. Typed `history_unavailable` reason not added (deferred — envelope unchanged).

### F3 — Unbounded history reads silently truncate at PostgREST max-rows

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/history.ts:37-50, 77-83
- **Detail**: `getRecentLikes` and `getDislikedIds` are unbounded by design, but PostgREST caps responses at `max-rows` (default 1000) with no error. Past that cardinality `getDislikedIds` silently truncates and FR-009 — the PRD's one absolute rule — can be violated (a disliked recipe past row 1000 re-enters pools); truncated likes let a liked recipe pose as "new". Years away at MVP usage, but the failure mode is invisible and the code comment's premise ("the full id set doubles as the exclusion list") is silently false at scale.
- **Fix A ⭐ Recommended**: Correct the comment to state the cap and the ~1000-rating threshold, and record a lesson to add truncation detection before rating cardinality grows.
  - Strength: Zero behavioral risk now; the false premise stops propagating; matches MVP scale honestly.
  - Tradeoff: FR-009 remains structurally breakable above ~1000 ratings per user.
  - Confidence: HIGH — MVP cardinality makes the window unreachable soon.
  - Blind spot: No alert fires as the threshold approaches.
- **Fix B**: Add a defensive guard now — fetch with `count: 'exact'` and degrade/throw when the count exceeds returned rows.
  - Strength: Makes truncation detectable and protects the PRD's absolute rule structurally.
  - Tradeoff: Extra code and tests for a years-away scenario.
  - Confidence: MED — the project's actual `max-rows` setting is unverified.
  - Blind spot: Behavior under a raised/lowered max-rows config untested.
- **Decision**: FIXED via Fix A + ACCEPTED-AS-RULE: "PostgREST reads are silently capped at max-rows" — comments on `getRecentLikes`/`getDislikedIds` now state the cap and its FR-009 consequence; lesson appended to `context/foundation/lessons.md`.

### F4 — Minor unplanned deviations (types.ts mode edit; header copy; h-full)

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/proposals/types.ts:12-18, src/components/proposals/ProposalList.tsx:72-75, src/components/proposals/RecipeCard.tsx:82-83
- **Detail**: Three benign deviations: (1) the plan said types extend "at the endpoint only", but the envelope's `mode` had to be added to the hand-defined `ProposalsResponse` in types.ts (single-declaration discipline preserved via `ProposalMode` re-export; landed in Phase 4 not 3, harmlessly); (2) an unplanned header-copy switch ("Shaped by what you've rated so far…") on personalized sets; (3) `h-full` on the card article, a layout consequence of the badge wrapper.
- **Fix**: Append a short addendum to plan.md documenting the three deviations so future reviews don't re-litigate them.
- **Decision**: FIXED — "Addendum — implementation review (2026-08-09)" appended to plan.md covering all three deviations plus the review-driven contract extensions.

### F5 — Workflow-policy change rode along in the Phase 1 feature commit

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: .claude/skills/10x-implement/SKILL.md (commit 81716b4)
- **Detail**: The commit removes the AskUserQuestion commit-message approval gate from the 10x-implement skill (both phase ritual and epilogue). The commit body says "staged per user request", so it was authorized — but it is a process-policy change (removing a human approval checkpoint) bundled into a feature commit, invisible to anyone reviewing the feature.
- **Fix**: No code change; going forward, land workflow/skill policy edits as separate chore commits (candidate lesson).
- **Decision**: ACCEPTED — user-authorized change, now visible in the plan addendum; convention (separate chore commits for policy edits) noted for future work.

### F6 — Migration hardening notes (rollback precondition; anon grants)

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260809120000_personalized_proposal_slots.sql:16, 37, 58
- **Detail**: (1) `DROP NOT NULL` is forward-safe but one-way in practice: once NULL-cuisine rows exist, re-adding NOT NULL fails without backfill/delete, and a DB-only rollback while the new endpoint stays deployed makes `persist()` fail on every personalized set. The plan's rollback note ("valid while no NULL rows exist") is correct but lives only in the plan. (2) Explicit grants are SELECT-to-authenticated, but hosted Supabase default privileges typically also grant new public objects to `anon`/`service_role`; no leak today (RLS default-denies, GROUP BY views aren't auto-updatable) and this matches the two earlier migrations, but the grant surface doesn't express the intended boundary.
- **Fix**: Add the rollback precondition to the migration header comment; include `revoke all ... from anon` for both views in a future hardening migration (applies to earlier migrations' objects too).
- **Decision**: FIXED (comment) — rollback precondition documented above the `DROP NOT NULL` (comment-only edit; schema untouched). Anon-revoke hardening migration spun off as a background task chip.

### F7 — history.ts defense-in-depth gaps

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/history.ts:57-62, 37-99
- **Detail**: (1) `getStaleLikes` interpolates its `cutoffISO` string parameter into a PostgREST `.or()` filter where `,` and `(` are syntax — safe today (only caller passes a server-generated ISO string) but a future caller with user-derived input becomes a filter-logic injection. (2) No history query scopes by `user_id`; row scoping rests solely on RLS via the session client, while the write side (ratings.ts) passes `user.id` explicitly as a second layer.
- **Fix**: Change `getStaleLikes` to accept a `Date` and call `toISOString()` internally; pass `user.id` into the history functions and add explicit `.eq("user_id", ...)` to all four reads.
- **Decision**: FIXED — all four reads take `(client, userId, …)` with explicit `.eq("user_id")`; `getStaleLikes` takes a `Date` (ISO encoding structural); endpoint passes `user.id`; cutoff test asserts the user id and the Date shape.

### F8 — RecipeCard rate() has no in-flight guard

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/proposals/RecipeCard.tsx:50-70
- **Detail**: A fast double-tap (or like-then-dislike inside the round-trip window) fires two concurrent POSTs; the displayed verdict is whichever response settles last, not the last-sent intent. ProposalList solved the same race with a `useRef` guard (ProposalList.tsx:27-31). Stakes are only a transient wrong highlight (ratings cost no quota).
- **Fix**: Mirror the ref-based in-flight guard, or ignore responses when a newer request is pending.
- **Decision**: FIXED — `ratingInFlight` useRef guard mirroring ProposalList's pattern; cleared in `finally` alongside the pending state.

### F9 — recorded:false tolerance has no pinning test

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/pages/api/__tests__/proposals.test.ts
- **Detail**: Endpoint coverage is strong, but the one deliberately tolerant behavior — persist failure returns 200 with `recorded: false` (src/pages/api/proposals.ts:139-143) — has no test pinning it. It's a stated design decision (slot-2 semantics depend on proposals rows landing), so a regression to 500-on-write-failure would ship undetected.
- **Fix**: Add a test mocking `upsert`/`insert` to error and asserting 200 + `recorded: false`.
- **Decision**: FIXED — pinning test added to the persistence describe (upsert error → 200, `recorded: false`, set still served). Suite now 50 tests.
