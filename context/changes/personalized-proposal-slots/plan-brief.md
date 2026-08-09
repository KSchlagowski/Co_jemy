# Personalized 4-Slot Proposals (S-05) — Plan Brief

> Full plan: `context/changes/personalized-proposal-slots/plan.md`
> Research: `context/changes/personalized-proposal-slots/research.md`

## What & Why

Build the steady-state proposal engine — the product's core hypothesis. A user with rating history gets 4 slots: recently liked, liked-but-forgotten (≥2 weeks), taste-profile match, and random discovery, with 👎-rated recipes permanently excluded (US-01, FR-008, FR-009). This is what makes the app more than random recipe search.

## Starting Point

S-02/S-03 deliberately pre-paved this: `getRecipeById` exists unused, `proposals` records requested cuisine + timestamp with S-05-named indexes, and `rated_at` carries the exact recency semantics slot 1 needs. But no DB read path exists anywhere in the repo, there is no slot concept, cards never know their stored rating, and the `ratings ⋈ proposals` join has no FK — so a small SQL surface must be added.

## Desired End State

`POST /api/proposals` reads history first, then routes: no likes → cold-start (now dislike-aware); ≥1 like → a personalized set costing ~5.40 pts (2 searches + ≤2 by-id re-fetches). Cards carry slot badges and render their stored 👍 pre-selected. A 👎-rated recipe never reappears.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Steady-state call shape | 2 searches at number=20 (slot 3 = top affinity cuisine, slot 4 = random other) + 2 by-id ≈ 5.40 pts ≈ 9 sets/day | Keeps slot 4 a genuine outlier and a 40-recipe buffer for exclusion/dedupe; upgrade trigger already covers the cost | Plan (user choice) |
| Taste-profile join | SQL views (`security_invoker`) + 2 missing indexes in one migration | One round trip, aggregation in Postgres — honors the Workers CPU-light constraint | Plan (user choice) |
| By-id failure mode | Backfill slot from search pool, mark `degraded` | User always gets 4 full cards at no extra quota cost | Plan (user choice) |
| Scope adds | Rating hydration only; no `recipes` hardening, no `requested_type` | Slots 1/2 render only live-fetched fields, so lesson-2's trigger never fires; meal type is speculative | Plan (user choice) |
| Activation thresholds | Slot 1: ≥1 like · slot 2: stale ≥14 d · slot 3: ≥5 likes with cuisine signal — tunable constants | Research says a default can ship and be tuned; 5 is the PRD hint's lower bound | Research |
| Taste aggregation | Count all proposal events per cuisine across likes; top count wins | Simplest rule that tolerates cuisine-less likes and multi-cuisine recipes | Plan |
| `requested_cuisine` | Goes nullable; by-id events insert NULL | A sentinel string would pollute the affinity count | Plan |
| FR-009 on cold-start | `buildColdStartSet` gains `excludeIds`; dislikes always fetched first | A user with only dislikes still routes cold-start, and FR-009 binds there too | Research |

## Scope

**In scope:** migration (2 views, 2 indexes, 1 nullable column) · `src/lib/history.ts` read module · pure `buildPersonalizedSet` engine + tests (incl. first `getRecipeById` and budget coverage) · endpoint inversion + `slot`/`ratingVerdict` payload fields · card hydration + slot badges · stale quota docs refresh · wrong-reason bug fix.

**Out of scope:** `recipes` open-insert hardening (S-04) · `requested_type` meal facet · E2E tests (blocked on S-04's DELETE) · quota ledger · `recorded:false` retry · rating management UI.

## Architecture / Approach

Keep the engine/persistence split: `history.ts` does session-client reads (aggregation in Postgres views), `buildPersonalizedSet` stays pure and unit-testable (history in, provider calls out, all four concurrent), and the endpoint owns ordering (401 → history reads → provider → hydrate → persist append-only event rows → respond) with the envelope and status map unchanged.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Migration + history reads | Views/indexes + `history.ts`, zero behavior change | Views without `security_invoker` would leak rows cross-user |
| 2. Slot engine | Pure builder + full unit truth table | Budget/oracle tests colliding with the cold-start invariant |
| 3. Endpoint + payload | History-first routing, hydration, event persistence | Ordering regression (provider call before auth/history) |
| 4. UI slots + hydration | Badges, pre-selected 👍, honest degraded copy, docs | Badge copy misleading on cold-start sets |

**Prerequisites:** S-02 + S-03 shipped (done); Supabase migration access; production account with ratings for manual verification.
**Estimated effort:** ~3–4 sessions across 4 phases; phases 1 and 3 end with manual production checks.

## Open Risks & Assumptions

- ~9 sets/day at 5.40 pts is the accepted free-plan reality; dev testing draws from the same budget (upgrade trigger: $29/mo tier if it pinches).
- Thresholds and the aggregation rule are first-guess defaults — shipped as tunable constants, expected to be tuned with real usage.
- `recorded:false` gaps mean slot 2 can occasionally miss a set the user saw — accepted MVP noise.

## Success Criteria (Summary)

- A rated user's set is observably shaped: slot 1 shows a recent like with 👍 pre-selected; a 👎 recipe never reappears (US-01 acceptance criteria).
- Unit suite proves the budget invariant (exactly 2 searches + ≤2 by-id) and FR-009 exclusion against a non-empty rating set.
- One personalized set measures ≈5.40 pts via quota headers on production.
