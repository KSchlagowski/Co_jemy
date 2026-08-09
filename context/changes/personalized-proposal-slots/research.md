---
date: 2026-08-08T14:36:29+02:00
researcher: Claude (Fable 5)
git_commit: 299536ccebed5e61ec4ed194c456698185b554d8
branch: master
repository: Co_jemy
topic: "S-05 personalized-proposal-slots — codebase readiness for the 4-slot personalization logic"
tags: [research, codebase, proposals, ratings, spoonacular, supabase, slot-logic]
status: complete
last_updated: 2026-08-08
last_updated_by: Claude (Fable 5)
---

# Research: S-05 Personalized 4-slot Proposals — codebase readiness

**Date**: 2026-08-08T14:36:29+02:00
**Researcher**: Claude (Fable 5)
**Git Commit**: `299536c`
**Branch**: master
**Repository**: Co_jemy

## Research Question

Roadmap slice **S-05 `personalized-proposal-slots`** (`context/foundation/roadmap.md` §Slices): a user with rating history gets proposals observably shaped by it — slot 1 = recently liked; slot 2 = liked but not proposed in ≥2 weeks; slot 3 = new recipe matching the inferred taste profile; slot 4 = random discovery — with 👎-rated recipes permanently excluded (FR-009) and slot logic activating progressively. What does the codebase already provide, what was deliberately pre-built for S-05, and what gaps must the plan fill?

## Summary

S-02 and S-03 left the ground **deliberately prepared** for S-05: the `proposals` table records the app-requested cuisine and a `proposed_at` timestamp from the first migration, both S-05 access-path indexes exist with comments naming this slice, `getRecipeById` was built in the spike as "the slots-1/2 re-fetch path" (currently dead code), `requested_type` is a reserved always-NULL column, and `ratings.rated_at` was given exactly the "when the verdict was last expressed" semantics slot 1 needs.

What does **not** exist is any read path: the entire repo contains three `supabase.from()` calls and all are writes. There is no slot concept anywhere (DB, payload, UI), no rating-state hydration on cards, no `ratings ⋈ proposals` join capability via PostgREST (no FK), no typed DB model, and `searchRecipes` exposes no `diet`/`type` params and no id-exclusion — so FR-009 must be a post-fetch filter over the over-fetched pool. Two composite indexes the slot queries want are missing, and the spike's ~4.70-pt steady-state cost figure is stale against the shipped `number=20` (real shape ≈ 5.40 pts/set ≈ 9 sets/day).

One ordering hazard: the `recipes` open-insert hardening (lessons.md lesson 2) is filed as an S-04 prerequisite, but its trigger condition — rendering `recipes` rows back to users — actually fires first in S-05's slots 1/2.

## Detailed Findings

### 1. Proposal pipeline today (S-02 code)

**Endpoint** — `src/pages/api/proposals.ts`:
- `POST /api/proposals` only; zero request params ([proposals.ts:60](src/pages/api/proposals.ts:60)).
- Envelope (the convention later endpoints inherit): `{ ok: true, proposals, recorded, degraded }` / `{ ok: false, reason }`; status map `quota_exhausted→402, not_configured→503, http_error|network_error→502, unauthenticated→401, internal_error→500` ([proposals.ts:10-15](src/pages/api/proposals.ts:10), [:86](src/pages/api/proposals.ts:86)).
- Auth gate: middleware guards `/dashboard` only ([middleware.ts:4](src/middleware.ts:4)); every `/api/**` endpoint self-checks `context.locals.user` → 401 **before** any provider call — the only thing between an anonymous request and a spent quota point ([proposals.ts:64-67](src/pages/api/proposals.ts:64)).
- Order of operations today: build set from provider **first**, touch Supabase **second** ([proposals.ts:74](src/pages/api/proposals.ts:74) vs [:84](src/pages/api/proposals.ts:84)). Slot logic must invert this — history reads have to precede the provider calls.
- Secret-hygiene invariant: only the typed `reason` ever escapes; no provider URL/message reaches a body ([proposals.ts:57-58](src/pages/api/proposals.ts:57), [spoonacular.ts:93-98](src/lib/spoonacular.ts:93)).

**Set builder** — `src/lib/proposals.ts`:
- `buildColdStartSet()` ([proposals.ts:253-277](src/lib/proposals.ts:253)) takes **no arguments** — no userId, no client, no exclusion list — and has zero DB access. Pure: pick 2 distinct cuisines (`pickCuisinePair`, [:207-211](src/lib/proposals.ts:207), plain `Math.random()`), 2 concurrent `searchRecipes` calls, interleave A,B,A,B with dedupe-by-id ([:228-244](src/lib/proposals.ts:228)), `.slice(0, 4)`.
- **There are no "slots"** — the 4 items are just the first 4 of an interleaved list; no slot labels in the DTO, DB, or UI.
- Constants: `CUISINES` frozen six (italian, mexican, chinese, greek, thai, french) ([:4](src/lib/proposals.ts:4)), `PER_CALL = 20`, `SET_SIZE = 4`, `MAX_OFFSET = 20` ([:21-28](src/lib/proposals.ts:21)) — the offset cap is **measured**, not the provider's 900: at offset 50, chinese/greek/thai returned zero results while still charging the 1-pt base (S-02 plan, 2026-07-20).
- `degraded` = fewer than 2 distinct `requestedCuisine` in the final set ([:274-276](src/lib/proposals.ts:274)) — cuisine-count semantics that don't map onto "a slot fell back".
- On double call failure it returns `resultA.reason` unconditionally ([:263](src/lib/proposals.ts:263)) — if A is `network_error` and B is `quota_exhausted` the user sees the wrong (retryable) message; worth fixing when S-05 adds more concurrent calls.
- `sanitizeSummary` ([:174-204](src/lib/proposals.ts:174)) is a pure function reusable as-is for re-fetched recipes; known-incomplete pattern set (lessons.md lesson 3); no unit test exists for it.

**Provider client** — `src/lib/spoonacular.ts`:
- `searchRecipes(params)` ([:121-133](src/lib/spoonacular.ts:121)): always `addRecipeInformation=true`, never nutrition flags. `SearchParams` ([:32-37](src/lib/spoonacular.ts:32)) supports **only** `cuisine | number | offset | sort:"random"` — no `diet`, no `type`, no exclude-by-id.
- **`getRecipeById(id)` already exists** ([:136-141](src/lib/spoonacular.ts:136)) — `GET /recipes/{id}/information`, doc-commented as "the steady-state slots-1/2 re-fetch path". Currently dead code: zero production call sites, no unit test for its URL shape, single-object extraction, or 402 branch. `/information` returns `summary`, so re-fetched cards get excerpts through the existing sanitizer.
- Quota headers are parsed into `QuotaInfo` ([:39-49](src/lib/spoonacular.ts:39)) and attached to every result — then **discarded by every caller**. No runtime budget ledger exists; S-05 raises per-set cost, so this is where one would go.

**Persistence** — `persist()` in [proposals.ts:95-122](src/pages/api/proposals.ts:95), user's own anon-key session client (no service-role client exists anywhere in the repo):
- `recipes` upsert `{ spoonacular_id, title, image }`, `onConflict: "spoonacular_id", ignoreDuplicates: true` ([:105-108](src/pages/api/proposals.ts:105)).
- `proposals` insert `{ user_id (from session), spoonacular_id, requested_cuisine, requested_type: null }` ([:113-120](src/pages/api/proposals.ts:113)); `proposed_at` comes from the column default.
- Failure is swallowed into `recorded: false` with a 200 ([:81-83](src/pages/api/proposals.ts:81)) — so a set the user actually saw can be missing from proposal history, and slot 2's "not proposed in ≥2 weeks" can lie. The UI doesn't read `recorded`.

### 2. Ratings system today (S-03 code)

**Endpoint** — `src/pages/api/ratings.ts`, `POST` only:
- `{ spoonacularId, verdict: "like"|"dislike" }`, manual typeof validation (no zod, deliberate) ([ratings.ts:37-49](src/pages/api/ratings.ts:37)); `user_id` always from session, never the body ([:85](src/pages/api/ratings.ts:85)).
- Single upsert, `onConflict: "user_id,spoonacular_id"`, **`rated_at` written explicitly by the app on every call** ([:91](src/pages/api/ratings.ts:91)) so conflict-UPDATEs refresh it — docblock states this is "the recency signal S-05's slot rules read".
- Loud failure semantics (vs. proposals' tolerant `recorded:false`): FK 23503 → 404 `unknown_recipe`, other DB error → 500 `write_failed` ([:96-98](src/pages/api/ratings.ts:96)).
- No proposal-ownership check: any `spoonacular_id` with a `recipes` row is ratable — so **a rating can exist with zero matching `proposals` rows** for that user; taste-profile aggregation must tolerate cuisine-less likes.

**Semantics that bind S-05**:
- `rated_at` = "when the user last expressed this verdict". Upsert overwrites — no history; a 👍→👎→👍 flip destroys the original like-time. Slot 1's "recently liked" = `verdict='like' order by rated_at desc`; correct for flips (a re-affirmed dislike→like reads as recent), lossy for anything wanting "originally liked at".
- Ratings key on the **recipe**, not the proposal event — no FK, join column, or any link from `ratings` to `proposals`.

**UI** — `src/components/proposals/RecipeCard.tsx`:
- Card-local `verdict` state initialized to `null` on every mount ([RecipeCard.tsx:41](src/components/proposals/RecipeCard.tsx:41)); not optimistic (server-confirmed 200 only). **The card never knows its recipe's stored rating** — `ProposalPayload` carries no rating field. S-03's plan explicitly deferred hydration as "S-04/S-05 territory". Slots 1/2 by definition re-surface liked recipes; without hydration those cards render with both thumbs unselected.

### 3. Database schema and per-slot query-ability

Two migrations total; no views, functions, triggers, or seed.

**`recipes`** ([20260720181257_cold_start_proposals.sql:14-19](supabase/migrations/20260720181257_cold_start_proposals.sql:14)): `spoonacular_id bigint PK, title not null, image, created_at` — the literal FR-011 three-field set. RLS: authenticated select/insert with `using(true)`/`with check(true)` — the **open-insert first-write-wins hole** (lessons.md lesson 2).

**`proposals`** ([:21-30](supabase/migrations/20260720181257_cold_start_proposals.sql:21)): append-only event log — identity PK, `user_id uuid FK auth.users on delete cascade`, `spoonacular_id FK recipes`, **`requested_cuisine text not null`**, **`requested_type text NULL`** ("Reserved for S-05 (meal type)"), **`proposed_at timestamptz default now()`**. No unique on `(user_id, spoonacular_id)` — same recipe accumulates rows, so "last proposed at" is `max(proposed_at)`, which is truthful. Index `(user_id, proposed_at desc)` ([:33-34](supabase/migrations/20260720181257_cold_start_proposals.sql:33)), commented as S-05 slot-2's access path. RLS: select/insert own rows only; **no UPDATE or DELETE grant** — mutate-in-place "last proposed at" is not permitted; the design is append-a-row-per-proposal.

**`ratings`** ([20260808120000_rate_recipe.sql:13-22](supabase/migrations/20260808120000_rate_recipe.sql:13)): composite PK `(user_id, spoonacular_id)`, `verdict text check in ('like','dislike')`, `rated_at`. Index `(user_id, rated_at desc)` ([:26-27](supabase/migrations/20260808120000_rate_recipe.sql:26)), commented for S-05 recency. RLS: select/insert/update own rows; **no DELETE** (deferred to S-04 with FR-007 — which FR-009 names as the only escape from permanent exclusion).

Per-slot verdict:

| Need | Status | Detail |
|---|---|---|
| Slot 1 "recently liked" | ✅ supported | `ratings` filtered `verdict='like'` ordered by `rated_at desc`; index exists (verdict not in index → heap filter, fine at MVP cardinality). Card fields need a live `getRecipeById` (1 pt). |
| Slot 2 "liked, not proposed ≥2 weeks" | ⚠️ computable, not indexed for it | Derive `max(proposed_at) group by spoonacular_id`; existing index is `(user_id, proposed_at)` — good for recency lists, wrong for grouping by recipe. Missing: `proposals(user_id, spoonacular_id, proposed_at desc)`. No view/RPC exists; JS-side reduce conflicts with the CPU-light constraint. |
| Slot 3 taste profile | ⚠️ recorded, join is the problem | Cuisine lives on the proposal **event**, so likes → preferred cuisines requires `ratings ⋈ proposals` on `(user_id, spoonacular_id)`. No FK → PostgREST resource embedding can't resolve it: two round-trips + JS join, or a new view/RPC. Missing index `proposals(user_id, spoonacular_id)`. Semantic ambiguity: one recipe can be proposed under different cuisines across sets — "the cuisine of a liked recipe" is many-valued and no doc picks a rule. Only the cuisine facet has data (`requested_type` 100% NULL; `SearchParams` has no `diet`/`type`). |
| FR-009 👎 exclusion | ⚠️ cheap query, post-fetch enforcement | `verdict='dislike'` set via PK prefix scan. But `complexSearch` has no exclude-by-id param — exclusion must filter the over-fetched pool (20/call) in JS, and must handle a set shrinking below 4. Nice-to-have: partial index `where verdict='dislike'`. |

**Client/typing**: single anon-key factory `createClient(headers, cookies)` ([supabase.ts:5-24](src/lib/supabase.ts:5)), null when env unset. Called **without** a `Database` generic — **no generated DB types exist anywhere** (`supabase` CLI is a devDependency but no `gen types` script); all queries are untyped string-keyed. Middleware builds one client per request for `locals.user` and API routes build a second one; `locals` doesn't carry the client ([env.d.ts:1-5](src/env.d.ts:1)).

### 4. Quota economics (measured, from the F-01 spike)

- Cost formula `1 pt/call + 0.035/recipe` measured with **0% deviation**; `X-API-Quota-*` headers declared a reliable runtime budget instrument (parsed into `QuotaInfo`, currently discarded).
- **By-id re-fetch = 1.00 pt exactly** (spike measurement M5).
- Spike pre-computed a steady-state 4-slot set at **≈4.70 pts** (2 by-id + 2 searches at `number=10`) ≈ 10 sets/day — this figure is in `docs/reference/contract-surfaces.md:43` and is **stale**: S-02 shipped `number=20` (1.70/call), making the same shape 2×1.00 + 2×1.70 = **5.40 pts ≈ 9 sets/day**. Nobody has recomputed for S-05; the plan must pick slot-3/4 `number` deliberately.
- Binding request-shaping rules (spike findings §3): one `complexSearch` per pinned cuisine, never one per slot; over-fetch within calls; dev cap ≤25 pts/day; 402 is a typed expected outcome. Upgrade trigger already defined: $29/mo tier when real usage regularly exceeds ~10 sets/day or dev hits 402 >1×/week despite the cap.
- E2E `seed.spec.ts` spends a real proposal set per run — dev/test draws from the same 50-pt budget.

### 5. Frontend surface

- [dashboard.astro:21](src/pages/dashboard.astro:21) mounts `<ProposalList client:load />`; no server-side data fetching.
- `ProposalList.tsx`: flat `grid-cols-1 sm:grid-cols-2` of up to 4 cards keyed by id ([:91-95](src/components/proposals/ProposalList.tsx:91)) — no slot labels/ordering/empty-slot states. Hardcoded cold-start copy ([:58-60](src/components/proposals/ProposalList.tsx:58)) including the promise S-05 must make true ("Rate a few and your proposals start learning your taste"); degraded banner copy is cuisine-specific ([:85-90](src/components/proposals/ProposalList.tsx:85)).
- Wire contract: `ProposalPayload` ([proposals.ts:22-31](src/pages/api/proposals.ts:22)) = `{ id, title, image, excerpt, sourceName, sourceUrl, spoonacularSourceUrl, requestedCuisine }` — **no slot, no rating state, no proposedAt**. `src/components/proposals/types.ts` re-exports it type-only; extend the type at the endpoint, never hand-mirror (S-02 impl-review F5).
- `RecipeCard` link/credit discipline already handles re-fetched candidates: `safeUrl` http(s) allowlist, `sourceUrl` primary / `spoonacularSourceUrl` fallback, hostname credit fallback ([RecipeCard.tsx:22-33](src/components/proposals/RecipeCard.tsx:22), [:70-72](src/components/proposals/RecipeCard.tsx:70)).

### 6. Tests and pre-decided test scoping

- Vitest, node env, hand-wired `@/` alias + `astro:env/server` stub ([vitest.config.ts](vitest.config.ts)); no jsdom → no component tests.
- The cold-start suite **pre-authorizes S-05**: `expect(getRecipeById).not.toHaveBeenCalled()` is deliberately scoped to `buildColdStartSet` ([proposals.test.ts:76-77](src/lib/__tests__/proposals.test.ts:76)), and the testing-harness research states a **new** steady-state budget assertion is needed when S-05 lands, without tripping the cold-start oracle (two-call invariant, 3.40-pt cost reconciliation).
- Oracle discipline (binding pattern): assert constants from PRD/research, never import `PER_CALL`/`MAX_OFFSET` (mirror-test anti-pattern).
- Ratings endpoint fully unit-tested ([ratings.test.ts](src/pages/api/__tests__/ratings.test.ts)) including the fresh-`rated_at` guarantee — the explicit S-05 recency contract.
- Uncovered today: `getRecipeById` (entirely), `sanitizeSummary`, the 402 endpoint mapping, persist calls, `degraded` pass-through.
- Test-plan hooks: risk #3 ("👎'd recipe reappears") is S-05's — exclusion must key on integer `spoonacular_id`, cheapest layer integration, anti-pattern = testing with an empty rating set. Rollout **Phase 3** is explicitly gated on S-05 existing; Phase 4 e2e is login → propose → rate → re-propose (👎'd absent). E2E rating cleanup is currently impossible (no DELETE policy) — an S-05 e2e that rates will leak rows unless S-04 lands first or cleanup goes through SQL.

## Code References

- `src/pages/api/proposals.ts:60-92` — POST endpoint, envelope, status map, provider-before-DB ordering
- `src/pages/api/proposals.ts:95-122` — `persist()`: recipes upsert + proposals insert, `recorded:false` swallow
- `src/pages/api/proposals.ts:22-31` — `ProposalPayload` (extend here for slot/rating fields)
- `src/lib/proposals.ts:253-277` — `buildColdStartSet()` (no inputs, no DB)
- `src/lib/proposals.ts:4,21-28` — `CUISINES`, `PER_CALL=20`, `SET_SIZE=4`, `MAX_OFFSET=20`
- `src/lib/proposals.ts:174-204` — `sanitizeSummary` (reusable for re-fetches; untested)
- `src/lib/spoonacular.ts:32-37` — `SearchParams` (cuisine/number/offset/sort only)
- `src/lib/spoonacular.ts:136-141` — `getRecipeById` (dead code, built for slots 1/2)
- `src/lib/spoonacular.ts:39-49` — `QuotaInfo` parsing (discarded by all callers)
- `src/pages/api/ratings.ts:86-94` — ratings upsert, explicit `rated_at` refresh
- `src/components/proposals/RecipeCard.tsx:41` — rating state resets on mount (no hydration)
- `src/components/proposals/ProposalList.tsx:91-95` — flat card grid, no slot concept
- `supabase/migrations/20260720181257_cold_start_proposals.sql:21-34` — proposals table + S-05 index
- `supabase/migrations/20260808120000_rate_recipe.sql:13-27` — ratings table + S-05 index
- `src/lib/supabase.ts:5-24` — anon-key session client factory (no `Database` generic)
- `src/middleware.ts:4-16` — `/dashboard`-only protection; `locals.user` on every request

## Architecture Insights

1. **Pre-paved paths**: both migrations carry comments naming S-05 as the consumer of their indexes; `requested_type` and `getRecipeById` exist solely for this slice. The plan should consume these, not re-invent them.
2. **Append-only event-log design**: `proposals` has no update grant by design — "last proposed at" is an aggregate over events, not a mutable column. Steady-state slots must keep inserting `proposals` rows (with their slot's requested cuisine or a sentinel) or slot 2's semantics silently rot. Nowhere is this stated explicitly; it is implied and must be made a plan requirement.
3. **RLS-as-boundary, no service role**: every read S-05 needs (own ratings, own proposals) is already granted to the session client. New reads need no new policies — but any new endpoint must repeat the manual 401-before-provider-call gate.
4. **Engine/persistence split**: `src/lib/proposals.ts` is pure provider-shaping with zero DB access; persistence lives in the endpoint. S-05 can keep this split (history reads in the endpoint or a new `src/lib/ratings.ts`, slot assembly pure and unit-testable) — which also keeps the Workers CPU-light constraint honest.
5. **Single-declaration wire types**: payload changes propagate compile-safely via `types.ts` re-exports.
6. **Cost shape**: call count dominates; the over-fetched 20-per-call pool is the buffer that absorbs both 👎-exclusion and dedupe-against-slots-1/2. Additional pinned cuisines are +1 pt each; by-id re-fetches are 1 pt each.

## Historical Context (from prior changes)

- `context/archive/2026-07-16-spoonacular-retrieval-spike/findings.md` — measured cost formula (0% deviation), M5 by-id = 1.00 pt, steady-state ≈4.70 pts/set (at `number=10`; stale), sourceUrl 98% alive → graceful error state (no active reachability check), binding request-shaping rules, $29/mo upgrade trigger.
- `context/archive/2026-07-20-cold-start-proposals/plan.md` — schema decisions (requested-cuisine recording promoted from unknown to decision; `requested_type` reserved for S-05; the S-05 index), the offset-50 zero-result measurement behind `MAX_OFFSET=20`, degraded-flag semantics (plan-review F3), persist-then-respond tolerance.
- `context/archive/2026-08-08-rate-recipe/plan.md` — `rated_at` semantics chosen *for* S-05's recency reads; 👎-exclusion and rating hydration explicitly deferred to S-05; loud-failure rationale; `recipes` open-insert hardening filed as S-04 prerequisite (trigger actually fires in S-05 — see Open Questions).
- `context/foundation/lessons.md` — all three lessons apply: timing-safe guards (any new guarded endpoint), the `recipes` shared-trust surface (lesson 2 trigger = S-05 slots 1/2), enumerated-filter incompleteness (`sanitizeSummary` on re-fetched summaries).
- `context/foundation/test-plan.md` — Phase 3 (rating-loop persistence & isolation, risks #2/#3/#7) opens once S-05 exists; risk #3 protection spec.
- `docs/reference/contract-surfaces.md` — binding registry; its 2.71/4.70 quota rows are stale re: `number=20` and should be updated by S-05.

## Related Research

- `context/changes/testing-harness-proposal-units/research.md` — quota-budget risk #1 test scoping; pre-authorizes S-05's `getRecipeById` use and calls for a new steady-state budget assertion.

## Open Questions

1. **Slot-activation thresholds** (roadmap unknown, owner: user, non-blocking): PRD says "sufficient rating history"; only numeric hint anywhere is the PRD Socrates note "fewer than 5–10 ratings" for slot 3. A default can ship and be tuned — the plan should pick per-slot minimums (e.g. slot 1: ≥1 like; slot 2: ≥1 like older than 14 days in proposal history; slot 3: ≥N likes with cuisine signal) and state them as tunable constants.
2. **Steady-state quota shape**: recompute the per-set cost for the actual design (how many searches at what `number`, how many by-id re-fetches) and update the stale 4.70 figure; decide whether slot 3 and slot 4 share one search call's over-fetch or pin different cuisines (+1 pt).
3. **Taste-profile aggregation rule**: a liked recipe can carry multiple `requested_cuisine` values across proposal events — count every event, or the event nearest `rated_at`? Undecided anywhere; the plan must pick one.
4. **Join mechanics**: `ratings ⋈ proposals` has no FK — two-query JS join vs. a new SQL view/RPC (CPU-light constraint favors SQL). If SQL, that is a new migration alongside the two missing indexes (`proposals(user_id, spoonacular_id, proposed_at desc)`, optional partial dislike index).
5. **S-04 ordering / `recipes` hardening**: lesson 2's trigger ("recipes rows rendered back to users") fires at S-05, not S-04 — though if slots 1/2 render exclusively from live `getRecipeById` responses (not stored title/image), exposure is limited to the id itself. Decide: harden in S-05, or render only live-fetched fields and leave hardening to S-04.
6. **Rating hydration**: deferred from S-03 as "S-04/S-05 territory", unassigned. Slots 1/2 showing a liked recipe with unselected thumbs undermines "observably shaped by rating history" — likely belongs in S-05's payload extension.
7. **`requested_type`**: start sending a meal `type` (requires `SearchParams` extension + write-path change) or leave NULL for S-05? Nothing forces it; cuisine-only profile is the smaller slice.
8. **Silent history gaps**: `recorded:false` sets are invisible to slot 2. Accept as MVP noise, or tighten (e.g. surface `recorded` in UI, retry persist)?
9. **By-id re-fetch failure mode**: if `getRecipeById` fails (or 402s) for a slot-1/2 recipe mid-set, does the slot fall back to the search pool, render a degraded stored-fields card, or drop? Interacts with the wrong-reason bug at `src/lib/proposals.ts:263`.
