# Rate Recipe (S-03) — Plan Brief

> Full plan: `context/changes/rate-recipe/plan.md`

## What & Why

Add the 👍/👎 rating loop (roadmap S-03, PRD FR-004): a logged-in user rates any proposed recipe and the rating persists reliably across sessions. This is the PRD's guardrail slice — losing rating history destroys the core value loop — so it introduces the ratings schema and deliberately nothing else.

## Starting Point

S-02 (cold-start proposals) is implemented and live: the dashboard shows up to 4 recipe cards from Spoonacular, and the `recipes` + `proposals` tables exist with RLS conventions, a JSON-envelope endpoint pattern, and a Vitest harness already established. Ratings have zero code today — but S-02's migration pre-built the rating-history index and the API/RLS conventions this slice copies.

## Desired End State

A user taps 👍 or 👎 on a proposal card; the button confirms only after the server persists it; tapping the other thumb flips the rating. The rating survives sign-out/sign-in and is invisible to other users. (The screen that *displays* rating history is S-04.)

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Re-rating | Upsert — re-tap flips the verdict in place | One UPDATE policy + one upsert makes the UI forgiving; S-04 keeps the management screen and delete |
| `recipes` open-insert hardening (lessons.md #2) | Defer to S-04, recorded as its prerequisite | This slice renders live API data, not recipes-table rows — the lesson's trigger condition hasn't fired yet |
| Rate target | Any recipe with a `recipes` row (FK only, no proposal-ownership check) | Ratings only affect the rater's own proposals; the FK does the integrity work |
| Rating UX | Wait for server — selected state only after 200 | The UI must never claim persistence that didn't happen (the guardrail), and it matches the existing in-flight-guard pattern |
| Test depth | Unit tests here; real-RLS integration + E2E open later as test-plan rollout Phase 3 | Matches the established phased test rollout; the copied RLS pattern is already live-verified in S-02 |
| Write-failure semantics | Loud 500, not S-02's tolerant `recorded: false` | A 200 must mean "persisted" for the wait-for-server contract to be honest |

## Scope

**In scope:** `ratings` table (composite PK `(user_id, spoonacular_id)`, verdict check, per-user RLS select/insert/update), `POST /api/ratings` (envelope, manual validation, upsert), thumb buttons on `RecipeCard`, endpoint unit tests, manual live verification.

**Out of scope:** rated-recipes list / change-delete UI (S-04), 👎-exclusion and slot logic (S-05), DELETE policy, `recipes` hardening, rating-state hydration on fresh proposal sets, E2E/integration tests (test-plan Phase 3).

## Architecture / Approach

Third table for the app's own data, structurally separate from provider-derived `recipes` so a forced provider purge leaves rating events intact (FR-011 / contract-surfaces.md). Endpoint inherits the proposals envelope: 401 gate → 503 unconfigured → manual validation → single upsert refreshing `rated_at` (S-05's recency rules read that timestamp). Card-local React state: idle → in-flight (disabled) → server-confirmed verdict.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema migration | `ratings` table + RLS, human-applied to prod | Prod push is human-only; policy shape must match S-02's `(select auth.uid())` form |
| 2. Endpoint + unit tests | `POST /api/ratings` with upsert + leak-face suite | Error mapping (FK → 404, else 500) — a silent write failure would fake the guardrail |
| 3. UI + live verification | Thumbs on cards, wait-for-server state, live loop check | Persistence is verified via Studio, not UI — user-visible proof lands in S-04 |

**Prerequisites:** S-02 live (✓ verified 2026-07-21); Supabase project linked for the human `db push`.
**Estimated effort:** ~2 sessions across 3 phases; Phase 1 needs a human pause for the prod migration.

## Open Risks & Assumptions

- The `recipes` open-insert spoofing window (lessons.md #2) stays open one more slice — deferred deliberately, recorded as an S-04 prerequisite in change.md.
- Cross-user isolation is manually verified until the test-plan's Phase 3 change adds real-RLS integration tests.
- A previously rated recipe reappearing in a new set renders unrated (no hydration) — accepted MVP behavior; upsert keeps re-rating idempotent.

## Success Criteria (Summary)

- Rating a card persists a row that survives sign-out/sign-in and belongs only to the rater
- Re-tapping flips the verdict in place with `rated_at` refreshed (S-05-ready semantics)
- The card never shows a selected thumb the server didn't confirm
