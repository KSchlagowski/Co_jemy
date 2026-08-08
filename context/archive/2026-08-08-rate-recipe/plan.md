# Rate Recipe (S-03) Implementation Plan

## Overview

Add the 👍/👎 rating loop (roadmap S-03, PRD FR-004): a logged-in user can rate any proposed recipe, the rating persists reliably across sessions, and a re-tap changes the rating in place. This slice introduces the ratings schema — the PRD's persistence guardrail lives here, so the slice is deliberately small: one table, one endpoint, thumb buttons on the existing proposal cards.

## Current State Analysis

- **S-02 is implemented and live-verified** (`context/changes/cold-start-proposals/verification.md`, merge `b6d64cd`). The dashboard renders `<ProposalList client:load />` which fetches `POST /api/proposals` and shows up to 4 `RecipeCard`s from live Spoonacular data.
- **No rating code exists** — no table, endpoint, or component. `ProposalList.tsx:59` already ships the teaser copy ("Rate a few and your proposals start learning your taste").
- **Schema groundwork is pre-built.** `supabase/migrations/20260720181257_cold_start_proposals.sql` created `recipes` (the three FR-011-permitted provider fields) and `proposals` (per-user request log). Its index `proposals_user_id_proposed_at_idx` is commented as "access path for S-03's rating history". No UPDATE or DELETE policy exists on any table yet.
- **Conventions are settled** by S-02 and binding here:
  - JSON envelope + status map defined in `src/pages/api/proposals.ts` ("the envelope later endpoints inherit"): `{ ok: true, ... } | { ok: false, reason }`, local `json()` helper.
  - Middleware guards `/dashboard` only — **`/api/**` endpoints check `context.locals.user` themselves and return 401 before doing anything else** (unit-test-asserted in `src/pages/api/__tests__/proposals.test.ts`).
  - Supabase access is the per-request anon-key factory `createClient(headers, cookies)` from `@/lib/supabase`, which returns `null` when unconfigured → 503 `service_unavailable`. No service-role client exists; **RLS is the access-control boundary**.
  - Validation is manual `typeof` guards — no zod, deliberately.
  - RLS pattern for per-user tables: `grant` + policies using `(select auth.uid()) = user_id` (subquery form is deliberate — planner hoists it).
  - **Prod schema pushes are human-only** (`context/changes/deployment/deployment-plan.md` §Production-access boundary): the agent authors the migration and stops; `npx supabase db push --linked` is a Manual Verification step. The linked project IS production.
- **Testing harness**: Vitest (`src/**/__tests__/*.test.ts`, node env, hand-wired `@/` alias + `astro:env/server` stub). The endpoint-test template is `src/pages/api/__tests__/proposals.test.ts` (hand-built `APIContext`, leak-face assertions). The env stub `test/stubs/astro-env-server.ts` exports only `SPOONACULAR_API_KEY`; DB-path tests mock `@/lib/supabase` instead.

## Desired End State

A logged-in user on `/dashboard` taps 👍 or 👎 on any proposal card; the button confirms only after the server persists the rating; tapping the other thumb changes the rating in place. The rating survives sign-out/sign-in (verified at the DB level — the rated-recipes *screen* is S-04). Another user cannot read or affect it.

### Key Discoveries:

- `getByRole`-friendly card markup already exists in `src/components/proposals/RecipeCard.tsx`; the card's client-side type (`ProposedRecipe` in `src/components/proposals/types.ts`) carries the recipe `id` the rating needs.
- Every recipe a user can see on a card already has a `recipes` row — `POST /api/proposals` upserts `recipes` before inserting `proposals` (`src/pages/api/proposals.ts:84-111`) — so an FK from ratings to `recipes(spoonacular_id)` is sufficient integrity for "rate any known recipe".
- `context/foundation/lessons.md` lesson 2: the `recipes` open-insert policy (`with check (true)`) becomes a shared-trust problem only when recipes-table rows are rendered back to users. This slice renders live API data, not `recipes` rows — hardening is **deferred to S-04** (decision below) and recorded as its prerequisite.
- Test-plan risks #2 (persistence/isolation, cheapest honest layer = integration with real RLS) and #3 (exclusion keyed on stable `spoonacular_id`) target this slice's data but their machine verification belongs to the test-plan's rollout Phase 3, which opens as its own change once this slice exists.

## What We're NOT Doing

- **No rated-recipes list, no rating change/delete UI** — FR-005/006/007 are S-04 (`manage-rated-recipes`). No DELETE policy is created here.
- **No 👎-exclusion or slot logic** — FR-008/009 are S-05. This slice only writes the data S-05 will read.
- **No `recipes` insert-policy hardening** — deferred to S-04 (the slice that first renders recipes-table rows back to users). Recorded in change.md Notes as an explicit S-04 prerequisite.
- **No rating-state hydration on fresh proposal sets** — a previously rated recipe that reappears in a new set renders unrated; the upsert makes re-rating idempotent. Persisted-state display is S-04/S-05 territory.
- **No E2E or real-RLS integration tests** — test-plan rollout Phase 3 covers those as its own change.
- **No proposal-ownership check** — any `spoonacular_id` with a `recipes` row is ratable (MVP flat-trust; ratings only influence the rater's own proposals).

## Implementation Approach

Mirror S-02's shape one layer at a time: migration (Phase 1) → endpoint + unit tests (Phase 2) → UI + live verification (Phase 3). Ratings are the app's own data (PRD §Guardrails): a third table separate from provider-derived `recipes`, keyed `(user_id, spoonacular_id)`, so a forced provider-data purge leaves rating events intact. The endpoint is a single upsert — unlike proposals' tolerant `recorded: false` write, **a failed rating write fails the request loudly**, because persistence is the product here.

## Critical Implementation Details

- **Timestamp semantics bind S-05.** Slot 1 ("recently liked") and slot 2 ("liked, not seen ≥2 weeks") read rating recency. The upsert must refresh `rated_at` on every verdict write (including 👍→👎→👍 flips), not preserve the original insert time — so `rated_at` means "when the user last expressed this verdict".
- **Write failure is a 500, not `recorded: false`.** The S-02 precedent of degrading gracefully on write errors does not apply: the UI's wait-for-server contract depends on a 200 meaning "persisted". Map FK violation (Postgres `23503`, unknown recipe) to 404 `unknown_recipe`; other DB errors to 500 `write_failed`.

## Phase 1: Ratings Schema Migration

### Overview

Create the `ratings` table with per-user RLS, following the S-02 migration's conventions (comment discipline, `(select auth.uid())` policy form, explicit grants). Author only — applying to prod is human-run.

### Changes Required:

#### 1. Ratings migration

**File**: `supabase/migrations/<timestamp>_rate_recipe.sql` (generate timestamp via `npx supabase migration new rate_recipe` or date-formatted by hand)

**Intent**: The ratings schema — the app's own data, structurally separate from provider-derived `recipes` so it survives a forced purge (PRD §Guardrails, `docs/reference/contract-surfaces.md:23`).

**Contract**:
- `public.ratings`: `user_id uuid not null references auth.users(id) on delete cascade`, `spoonacular_id bigint not null references public.recipes(spoonacular_id)`, `verdict text not null check (verdict in ('like','dislike'))`, `rated_at timestamptz not null default now()`; **primary key `(user_id, spoonacular_id)`** — composite PK enforces one rating per user per recipe and is the upsert conflict target; no identity column, so no sequence grant needed.
- Index `ratings_user_id_rated_at_idx on (user_id, rated_at desc)` — mirrors the proposals index; access path for S-05's recency rules. Comment it as such.
- RLS enabled; `grant select, insert, update on public.ratings to authenticated`; policies for select/insert/update all scoped `(select auth.uid()) = user_id` (update needs both `using` and `with check`). **No delete** — S-04 adds it with FR-007.
- Migration header comment: name the FR-011 separation rationale and note that the `recipes` open-insert hardening (lessons.md lesson 2) is deliberately deferred to S-04.

#### 2. Change-log note

**File**: `context/changes/rate-recipe/change.md`

**Intent**: Record the deferred `recipes` hardening as an explicit S-04 prerequisite so it can't slip (the decision made in planning).

**Contract**: Append to `## Notes`: S-04 must harden `recipes` inserts (lessons.md lesson 2) before rendering recipes-table rows back to users.

### Success Criteria:

#### Automated Verification:

- Migration file exists under `supabase/migrations/` and `npm run lint` passes (no TS touched; guards against accidental edits)
- Local apply is clean if a local stack is running: `npx supabase db reset` (skip if no local stack; prod push is manual)

#### Manual Verification:

- Human reviews the migration and applies it: `npx supabase db push --linked` (production — human-only boundary)
- In Supabase Studio: `ratings` table present with composite PK, check constraint, three policies, no delete policy

**Implementation Note**: Pause after this phase for the human `db push` before Phase 2's endpoint can be exercised against real data. Phase blocks use plain bullets — checkbox state lives in `## Progress`.

---

## Phase 2: Rating Endpoint + Unit Tests

### Overview

`POST /api/ratings` inheriting the proposals envelope, with upsert semantics and loud write failures; unit tests per the established leak-face pattern.

### Changes Required:

#### 1. Rating endpoint

**File**: `src/pages/api/ratings.ts`

**Intent**: Accept `{ spoonacularId, verdict }`, upsert the caller's rating, return the persisted verdict. Single write, no provider calls, no quota cost.

**Contract**:
- Request: JSON body `{ spoonacularId: number (positive integer), verdict: "like" | "dislike" }`. Manual `typeof`/integer/enum guards — malformed body or fields → 400 `invalid_payload`.
- Gate order (matches `proposals.ts`): `locals.user` → 401 `unauthenticated` first; `createClient` null → 503 `service_unavailable`.
- Write: upsert on `ratings` with `onConflict: "user_id,spoonacular_id"`, setting `verdict` and refreshing `rated_at` to now (see Critical Implementation Details — recency semantics).
- Failure mapping: Postgres FK violation `23503` → 404 `unknown_recipe`; any other DB error → 500 `write_failed`. Success → 200 `{ ok: true, verdict }`.
- Status map lives in a `Record<FailureReason, number>` like `proposals.ts:10-15`.

#### 2. Endpoint unit tests

**File**: `src/pages/api/__tests__/ratings.test.ts`

**Intent**: Leak-face and contract tests following `src/pages/api/__tests__/proposals.test.ts` (hand-built `APIContext`) and the `vi.mock` module-mock convention from `src/lib/__tests__/proposals.test.ts`.

**Contract**: Cover at minimum: (1) no `locals.user` → 401 and no Supabase client constructed; (2) invalid payloads (missing field, non-integer id, unknown verdict, non-JSON body) → 400; (3) success path with `@/lib/supabase` mocked → upsert called with `onConflict: "user_id,spoonacular_id"`, the caller's `user_id` (never from the body), and a refreshed `rated_at`; (4) FK-violation error shape → 404, other DB error → 500. If the import graph needs it, extend `test/stubs/astro-env-server.ts` to also export `SUPABASE_URL`/`SUPABASE_KEY` (undefined-tolerant, same style as the existing export).

### Success Criteria:

#### Automated Verification:

- `npm test` green (new ratings suite + existing 13 tests)
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- None in this phase — the live loop is Phase 3's manual verification (the endpoint alone isn't user-exercisable without the UI).

---

## Phase 3: Rating UI on Proposal Cards

### Overview

Thumb buttons on `RecipeCard` with wait-for-server state; live verification of the persistence guardrail.

### Changes Required:

#### 1. Rating buttons

**File**: `src/components/proposals/RecipeCard.tsx`

**Intent**: 👍/👎 buttons on each card. Tap → both buttons disable (in-flight) → on 200, selected state renders (`aria-pressed`); tapping the other thumb re-submits and flips. On failure, buttons re-enable with a short inline error using the reason→copy mapping style of `ProposalError.tsx`. State is card-local (each card owns its rating lifecycle); match the card's existing copy language.

**Contract**: Buttons are `<button>` with accessible names (rate-like / rate-dislike) so tests use `getByRole`. No optimistic selection — selected state only ever reflects a server-confirmed verdict. React 19 compiler rules apply (no manual memo, no conditional hooks).

#### 2. Client types + fetch helper

**File**: `src/components/proposals/types.ts` (and a small fetch call in the card or a sibling helper)

**Intent**: Mirror the endpoint envelope client-side, as `types.ts:17-19` already does for proposals.

**Contract**: `RatingResponse` discriminated union matching the endpoint's `ok`/`reason` shape; `POST /api/ratings` with `Content-Type: application/json`.

### Success Criteria:

#### Automated Verification:

- `npm test` green
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- On `/dashboard`: tap 👍 on a card — buttons disable, then 👍 shows selected; tap 👎 on the same card — flips
- Persistence: after rating, sign out and back in, confirm the `ratings` row (correct `user_id`, `spoonacular_id`, `verdict`, refreshed `rated_at`) in Supabase Studio — user-visible persistence display is S-04
- Isolation: from a second account, confirm the first user's rating is neither visible nor affected (Studio check: RLS policies scope every query)
- Rate → request a new proposal set → if the same recipe reappears, rating it again succeeds (idempotent upsert, no duplicate-key error)
- After merge/deploy: repeat the rate action once on production

**Implementation Note**: Pause here for manual confirmation of the live loop before considering the slice done.

---

## Testing Strategy

### Unit Tests:

- Endpoint leak faces: 401 before any work, 400 on malformed payloads, `user_id` always taken from `locals.user` (never the body)
- Upsert contract: conflict target `user_id,spoonacular_id`, `rated_at` refreshed on every write
- Error mapping: FK `23503` → 404, other DB errors → 500 (no Supabase error message leaked into the envelope)

### Integration Tests:

- Deliberately deferred: real-RLS persistence/isolation (test-plan risk #2) and 👎-exclusion keying (risk #3) open as the test-plan's rollout Phase 3 change once this slice ships.

### Manual Testing Steps:

1. Rate, flip, re-rate — card state honest at each step (only server-confirmed)
2. Sign-out/sign-in persistence check via Studio row inspection
3. Second-account isolation check
4. Production smoke after deploy

## Performance Considerations

One DB upsert per tap; no Spoonacular calls, so zero quota impact. Composite PK + `(user_id, rated_at desc)` index cover both this slice's writes and S-05's planned reads. Nothing else at this scale.

## Migration Notes

Forward-only migration; no existing data affected. Prod apply is human-run (`npx supabase db push --linked`) — the linked project is production, no staging. Rollback = dropping the table (no other object depends on it in this slice).

## References

- Roadmap S-03: `context/foundation/roadmap.md:110-120` · PRD FR-004, §Guardrails
- Envelope + endpoint conventions: `src/pages/api/proposals.ts` · test template: `src/pages/api/__tests__/proposals.test.ts`
- Schema conventions + forward references to S-03: `supabase/migrations/20260720181257_cold_start_proposals.sql`
- Ratings/recipes separation rationale: `docs/reference/contract-surfaces.md:23`
- Deferred hardening: `context/foundation/lessons.md` (lesson 2) — S-04 prerequisite
- Test rollout ownership: `context/foundation/test-plan.md` risks #2, #3, #7 (Phase 3, opens separately)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Ratings Schema Migration

#### Automated

- [x] 1.1 Migration file exists under `supabase/migrations/` and `npm run lint` passes — c295af6
- [x] 1.2 Local apply clean via `npx supabase db reset` (skip if no local stack) — c295af6

#### Manual

- [x] 1.3 Human applies migration to prod: `npx supabase db push --linked` — c295af6
- [x] 1.4 Studio check: table, composite PK, check constraint, three policies, no delete policy — c295af6

### Phase 2: Rating Endpoint + Unit Tests

#### Automated

- [x] 2.1 `npm test` green (new ratings suite + existing tests) — e6dda46
- [x] 2.2 `npm run lint` passes — e6dda46
- [x] 2.3 `npm run build` passes — e6dda46

### Phase 3: Rating UI on Proposal Cards

#### Automated

- [x] 3.1 `npm test` green — 55dafa1
- [x] 3.2 `npm run lint` passes — 55dafa1
- [x] 3.3 `npm run build` passes — 55dafa1

#### Manual

- [x] 3.4 Tap 👍 → disabled in-flight → selected on 200; tap 👎 flips — 55dafa1
- [x] 3.5 Persistence across sign-out/sign-in confirmed via Studio row — 55dafa1
- [x] 3.6 Second-account isolation confirmed — 55dafa1
- [x] 3.7 Re-rating a reappearing recipe succeeds (idempotent upsert) — 55dafa1
- [x] 3.8 Production smoke after deploy
