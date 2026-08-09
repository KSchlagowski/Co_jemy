# Manage Rated Recipes (S-04) Implementation Plan

## Overview

S-04 delivers the rating-management surface: a list of everything the user has rated (FR-005), the ability to flip a rating 👍↔👎 from that list (FR-006), and the ability to delete a rating, returning the recipe to unrated status (FR-007). It also discharges the two structural decisions deferred to this slice: the `recipes` shared-trust hardening (lessons.md lesson 2) and the FR-010 attribution ruling for stored rows.

## Current State Analysis

From `context/changes/manage-rated-recipes/research.md` (authoritative codebase baseline):

- **FR-006 is already served at the API/DB layer.** `POST /api/ratings` ([src/pages/api/ratings.ts:60](../../../src/pages/api/ratings.ts)) upserts on the composite PK `(user_id, spoonacular_id)` with an UPDATE RLS policy in place. S-04 adds only the UI.
- **FR-007 has no backend.** The S-03 migration deliberately granted `select, insert, update` but not `delete` ([supabase/migrations/20260808120000_rate_recipe.sql:33-34](../../../supabase/migrations/20260808120000_rate_recipe.sql)). A new migration (grant **and** policy) plus a `DELETE` handler are required. Prod schema pushes are human-only (`npx supabase db push --linked`).
- **FR-005 can be served entirely from local data at zero Spoonacular cost.** `ratings.spoonacular_id` has a real FK to `recipes.spoonacular_id`, so one PostgREST embedded select returns everything the DB legally holds (FR-011: id, title, image). The supporting index `ratings(user_id, rated_at desc)` exists.
- **`recipes` is an un-hardened shared-trust surface.** Insert policy is `with check (true)` for `authenticated`; any account can pre-spoof a `spoonacular_id`/`title`/`image` row via the public anon key. The genuine upsert uses `ignoreDuplicates: true` and is silently discarded; no UPDATE policy can repair the row. S-04's list is the first time stored rows render back to users — the lesson-2 trigger fires now. No service-role client exists anywhere in the repo.
- **UI**: card chrome, image fallback, non-optimistic mutation, in-flight guard, and inline-error patterns are liftable; `RatingButton` is private to `RecipeCard.tsx`; no nav exists on authenticated screens; no empty-state or dialog primitive exists.
- **Conventions that bind**: envelope `{ ok } | { ok: false, reason }` + `STATUS_BY_REASON`; endpoint self-gates on `locals.user`; `user_id` from session, never the body; no zod, no generated DB types, no `useEffect`, `client:load` only; dark-only styling; PostgREST `max_rows = 1000` silent cap (lesson 4).

## Desired End State

- A logged-in user can open `/dashboard/ratings` from the dashboard, see every recipe they've rated (newest first) with title, image, and current verdict, flip any rating in place, and delete a rating via an inline two-step confirm — after which the recipe is proposable again (FR-009 exclusion resets automatically via the `security_invoker` views).
- `recipes` writes go through a server-only service-role client with a repairing upsert; `authenticated` can no longer insert into `recipes`.
- The E2E test plan is unblocked: rating rows can now be cleaned up via `DELETE /api/ratings`.

Verify by: signing in, rating a recipe on the dashboard, opening the ratings page, flipping it, deleting it, requesting proposals again and observing the recipe is eligible again.

### Key Discoveries:

- `@supabase/supabase-js` is already a direct dependency (package.json) — the service-role client needs no new package.
- Astro serves `src/pages/dashboard.astro` at `/dashboard` and `src/pages/dashboard/ratings.astro` at `/dashboard/ratings` side by side; the prefix match in [src/middleware.ts:4](../../../src/middleware.ts) protects the new route with zero changes.
- A `recipes` row is guaranteed to exist for every rating (proposals upserts the recipe before the rating FK can succeed), so the embedded join never legitimately returns a null recipe.
- Supabase delete reports no error on zero affected rows — idempotency vs 404 must be explicit; `.select()` on the delete observes the affected count.
- Deploy ordering constraint: the migration revoking `authenticated` insert on `recipes` must apply **after** the service-role write path is deployed, or the currently-deployed `persist()` starts failing recipe upserts and ratings on fresh recipes FK-404.

## What We're NOT Doing

- **No publisher credit or outbound link on the list rows** (decided): the management list is a non-proposal surface, so FR-010's "every proposal" obligation does not bind it, and `sourceName`/`sourceUrl` are not storable under FR-011. Zero live fetches — the page costs 0 quota points.
- **No pagination** — explicit `.limit(100)` with the cap documented; MVP cardinality sits far below it.
- **No dialog/toast primitive, no undo affordance** — inline two-step confirm only.
- **No warning on 👎-flip** (decided: silent flip, consistent with proposal cards; FR-007 delete is the documented escape).
- **No Topbar redesign** — simple in-page links between `/dashboard` and `/dashboard/ratings`.
- **No `GET /api/ratings` endpoint** — the list is server-rendered in the page frontmatter; mutations update island state locally on `ok: true`.
- **Not folding in the S-05 impl-review F6 anon-grant-revoke migration** — that remains its own filed task.
- **No validating trigger on `recipes`** — service-role writes supersede it.

## Implementation Approach

Three phases, each independently verifiable: (1) the hardening + schema work that everything else depends on, with a human-sequenced deploy; (2) the new API surface and data read, fully unit-tested on the existing Vitest harness; (3) the UI page and island. Decisions taken during planning:

| Decision | Choice |
| --- | --- |
| FR-010 on list | No credit/link — non-proposal surface (user-confirmed) |
| `recipes` hardening | Service-role writes + revoke `authenticated` insert (user-confirmed) |
| Delete UX | Inline two-step confirm, blur-resets (user-confirmed) |
| 👎-flip | Silent, no warning (user-confirmed) |
| Route | `/dashboard/ratings` (free middleware protection) |
| List data | SSR in frontmatter via `history.ts` read; no GET endpoint |
| Delete semantics | Idempotent 200; `.select()` observes affected rows |
| List bound | `.limit(100)` + cap comment (lesson 4) |

## Critical Implementation Details

- **Deploy ordering (Phase 1)**: the human steps must run in this order — (1) set `SUPABASE_SERVICE_ROLE_KEY` locally (`.env`) and on the Worker (`npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY`), (2) deploy the code that writes `recipes` via the admin client, (3) `npx supabase db push --linked` to apply the revoke. Reversing (2) and (3) breaks recipe persistence for the deployed code. The admin client bypasses RLS, so it works both before and after the migration.
- **Repairing upsert**: with the admin client, the `recipes` upsert drops `ignoreDuplicates: true` — genuine provider data now overwrites any pre-existing (possibly spoofed) row and refreshes stale titles/images. This is the point of the hardening, not an incidental change.
- **React compiler constraints (Phase 3)**: no `useEffect` anywhere in the repo — seed island state from SSR props; the two-step delete confirm resets on `onBlur` (the zero-effect, zero-timer option) rather than a timeout.
- **Embedded join shape**: `recipes(title, image)` across a many-to-one FK returns an object per row (not an array); without generated DB types the repo's string-keyed `as`-cast convention applies (`src/lib/history.ts:10-11`). Guard the theoretically-impossible null embed defensively rather than crashing the page.

## Phase 1: Hardening + Schema

### Overview

Introduce the service-role write path for `recipes`, then a single migration that adds the ratings DELETE grant + policy and revokes the now-unneeded `authenticated` insert on `recipes`. This is the phase with human deploy steps.

### Changes Required:

#### 1. Env declaration

**File**: `astro.config.mjs`

**Intent**: Declare the new server-only secret so `astro:env/server` exposes it.

**Contract**: Add `SUPABASE_SERVICE_ROLE_KEY: envField.string({ context: "server", access: "secret", optional: true })` to the env schema, alongside the existing three.

#### 2. Env documentation

**File**: `.env.example`

**Intent**: Document the new variable and where it comes from (Supabase project settings → service_role key; never exposed to the client).

**Contract**: One new line with a comment mirroring the existing entries' style.

#### 3. Service-role client module

**File**: `src/lib/supabase-admin.ts` (new)

**Intent**: The repo's first and only service-role client — used exclusively for the `recipes` catalogue upsert. Deliberately separate from `src/lib/supabase.ts` so the session-client path stays the default and the exception is greppable.

**Contract**: `createAdminClient(): SupabaseClient | null` — `createClient` from `@supabase/supabase-js` with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, `auth: { persistSession: false, autoRefreshToken: false }`; returns `null` when either env is unset (mirrors `createClient`'s null contract). A file-top comment must state the trust rationale (lesson 2) and that this client bypasses RLS — it must never be handed request-scoped or user-scoped work.

#### 4. Persist path switches to admin client

**File**: `src/pages/api/proposals.ts`

**Intent**: `persist()` writes `recipes` via the admin client with a repairing upsert; the user-scoped `proposals` insert stays on the session client (RLS-correct). A missing admin client degrades to the existing tolerant `recorded: false` path with a sanitized `console.error`, same as any other persist failure.

**Contract**: `persist()` gains the admin client (created per-request next to the session client or passed in); the recipes upsert keeps `onConflict: "spoonacular_id"` but drops `ignoreDuplicates: true`. Update the surrounding comment: re-proposing now *repairs/refreshes* the stored row rather than ignoring it.

#### 5. Migration

**File**: `supabase/migrations/<timestamp>_manage_rated_recipes.sql` (new)

**Intent**: (a) FR-007 backend: grant `delete` on `public.ratings` to `authenticated` + a delete policy scoped `(select auth.uid()) = user_id` (subquery form, matching S-03). (b) Lesson-2 hardening: drop the `recipes` insert policy and `revoke insert on public.recipes from authenticated` — writes now arrive only via service role, which bypasses RLS. Keep the `recipes` select grant/policy untouched (the embedded list read needs it).

**Contract**: One migration file, comments explaining both halves and referencing the S-03 deferral comment it discharges. Human-applied per repo convention.

#### 6. Persist tests updated

**File**: `src/pages/api/__tests__/proposals.test.ts`

**Intent**: Existing persist assertions updated for the admin-client path: recipes upsert goes through the admin mock (no `ignoreDuplicates`), proposals insert stays on the session mock, and a null admin client yields `recorded: false` without failing the set.

**Contract**: Mock `@/lib/supabase-admin` alongside the existing `@/lib/supabase` mock.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run test` passes (updated proposals persist tests green)
- `npm run build` passes (env schema accepted)

#### Manual Verification:

- Human deploy sequence completed in order: secret set (local + Worker) → code deployed → `npx supabase db push --linked`
- After deploy: requesting proposals returns `recorded: true`; rating a fresh proposal card still succeeds (FK path intact)
- Direct PostgREST insert into `recipes` with the anon key + a user session is rejected

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation of the deploy sequence before proceeding — Phases 2/3 assume the delete grant exists.

---

## Phase 2: API + Data Read

### Overview

The `DELETE` handler (first non-POST API route in the repo) and the list read, both unit-tested.

### Changes Required:

#### 1. DELETE handler

**File**: `src/pages/api/ratings.ts`

**Intent**: FR-007 endpoint. Same file as POST (Astro multi-method route), same envelope, same self-gate on `locals.user`, same body shape minus `verdict`.

**Contract**: `export const DELETE: APIRoute` — parse `{ spoonacularId }` (reuse the integer guard from `parsePayload`, refactored to share); delete `.eq("user_id", user.id).eq("spoonacular_id", …).select("spoonacular_id")`; DB error → `write_failed` 500 (loud, matching the rating-write posture); otherwise idempotent `{ ok: true, deleted: boolean }` 200 — zero affected rows is success (the user's intent holds; double-tap/race safe). Reuses the existing `FailureReason` set; no new reasons. Export a `RatingDeleteResponse`-shaped type for the client re-export.

#### 2. List read

**File**: `src/lib/history.ts`

**Intent**: `getRatedRecipes(client, userId)` — the FR-005 read. Single embedded select, newest first, explicitly bounded.

**Contract**: `.from("ratings").select("spoonacular_id, verdict, rated_at, recipes(title, image)").eq("user_id", userId).order("rated_at", { ascending: false }).limit(100)` — the `.limit` comment must name the PostgREST `max_rows` cap (lesson 4: this is a display list, not a correctness rule, so a bound beats count-checking). Throws on error like every other read here. Returns `RatedRecipe[]`: `{ spoonacularId, verdict: "like" | "dislike", ratedAt, title, image: string | null }`, flattening the embed; skip (and `console.error`) any row with a null embed rather than crashing.

#### 3. Wire types

**File**: `src/components/ratings/types.ts` (new)

**Intent**: Client-side view of the ratings-page contracts, following the single-declaration convention of `src/components/proposals/types.ts`.

**Contract**: Type-only re-exports: `RatedRecipe` from `@/lib/history`, `RatingVerdict` + delete/rating response shapes from `@/pages/api/ratings` (the existing `RatingResponse` can be re-exported from the proposals types or redeclared here — one declaration, endpoint-owned, either way).

#### 4. Tests

**File**: `src/pages/api/__tests__/ratings.test.ts`, `src/lib/__tests__/history.test.ts` (new)

**Intent**: DELETE handler covered on the existing harness: 401 unauthenticated, 400 invalid payload, 503 no client, 500 DB error, 200 happy path with `deleted: true`, 200 idempotent with `deleted: false`, and the session-`user_id` assertion mirroring the POST tests. `getRatedRecipes` covered for mapping, ordering/limit args, null-embed skip, and throw-on-error.

**Contract**: Same mock pattern as the existing ratings tests.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run test` passes (new DELETE + history tests green)
- `npm run build` passes

#### Manual Verification:

- `curl`-level (or browser devtools) DELETE against a real rated recipe returns `{ ok: true, deleted: true }`; repeating it returns `{ ok: true, deleted: false }`; the row is gone from the DB

---

## Phase 3: UI — Ratings Page + Island

### Overview

The user-facing slice: SSR page, list island with flip + two-step delete, empty state, and navigation links.

### Changes Required:

#### 1. RatingButton extraction

**File**: `src/components/proposals/RatingButton.tsx` (new), `src/components/proposals/RecipeCard.tsx`

**Intent**: Lift the private `RatingButton` (with its `aria-label`/`aria-pressed` contract) into its own exported module so the rated-recipe card reuses it; `RecipeCard` imports it. No behavior change.

**Contract**: Identical props/markup; `RecipeCard.tsx` shrinks by the moved block.

#### 2. Ratings island

**File**: `src/components/ratings/RatedRecipesList.tsx` (new, may include a `RatedRecipeCard` sub-component in the same folder)

**Intent**: The management list. Receives `initialRatings: RatedRecipe[]` (plus an optional load-error flag) as SSR props and seeds state from them — no fetch on mount, no `useEffect`. Each row: image with the `RecipeCard` fallback pattern (gradient + `UtensilsCrossed`), title, the two `RatingButton`s pre-selected to the stored verdict, and a delete control. No credit, no outbound link, no excerpt (decided). Flip: POST `/api/ratings`, non-optimistic (state updates only on `ok: true`), per-row in-flight guard + inline error, silent on 👎. Delete: two-step inline confirm (first tap swaps the control to a "Confirm delete?" state; second tap sends DELETE; `onBlur` resets to idle); on `ok: true` remove the row from local state. Empty state (also shown after deleting the last row): PRD-tone copy — not an error, proposals improve as you rate — with a link to `/dashboard`.

**Contract**: Mounted `client:load` (the only hydration directive in use). Styling follows the existing dark glass palette; `sm:` breakpoints only; `void` on async onClick handlers.

#### 3. Ratings page

**File**: `src/pages/dashboard/ratings.astro` (new)

**Intent**: SSR shell at `/dashboard/ratings` (middleware-protected via prefix). Frontmatter builds the session client, calls `getRatedRecipes(client, user.id)` in a try/catch, and renders the island with the rows — or with an error flag whose copy follows the `ProposalError` inline pattern (a failed read must not 500 the whole page). Includes a "← Dashboard" link.

**Contract**: Same `Layout` + glass-card shell as `dashboard.astro`; `Astro.locals.user` is guaranteed by middleware.

#### 4. Dashboard link

**File**: `src/pages/dashboard.astro`

**Intent**: Discoverable entry point — a "Rated recipes" link near the proposals section, styled like the existing purple link idiom.

**Contract**: One anchor to `/dashboard/ratings`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (react-compiler rule green — no effects, no conditional hooks)
- `npm run test` passes
- `npm run build` passes

#### Manual Verification:

- List shows all rated recipes, newest first, with correct verdict pre-selection and image fallback on a broken image URL
- Flip 👍→👎 persists (survives reload) and the card reflects it only after the server 200
- Delete requires two taps; clicking elsewhere resets the confirm state; deleted row disappears and stays gone on reload
- Deleted recipe becomes proposable again (request proposals; FR-009 exclusion no longer applies)
- Empty state renders with non-error tone for a user with no ratings and after deleting the last rating
- Navigation works both ways; `/dashboard/ratings` redirects to sign-in when logged out
- Page renders correctly on a phone-width viewport

---

## Testing Strategy

### Unit Tests:

- `DELETE /api/ratings`: auth gate, payload validation, session-scoped `user_id`, idempotent zero-row 200, DB-error 500
- `getRatedRecipes`: query args (order, limit, embed), row mapping, null-embed skip, throw on error
- Updated `persist()` tests: admin-client recipes upsert (no `ignoreDuplicates`), null-admin `recorded: false`

### Integration Tests:

- None this slice (the E2E rollout is the test-plan's own phased work; this slice *unblocks* it by making rating cleanup possible)

### Manual Testing Steps:

1. Full loop: rate on dashboard → open ratings page → flip → reload → delete (two-step) → reload → request proposals and see the recipe eligible again
2. Hardening: attempt an anon-key `recipes` insert with a user session (e.g. via PostgREST curl) — expect rejection; request proposals and confirm `recorded: true` via the admin path
3. Empty state + mobile viewport pass

## Performance Considerations

The ratings page costs **zero Spoonacular points** — one indexed DB query (`ratings_user_id_rated_at_idx`), bounded at 100 rows. Flip/delete are single-row DB writes. No provider calls anywhere in the slice.

## Migration Notes

- Single human-applied migration; **must be pushed only after** the service-role code path is deployed with its secret set (see Critical Implementation Details). No data backfill — the delete grant is purely additive, and the insert revoke changes future writes only.
- Rollback: re-grant insert + recreate the old policy; the delete grant can stay (it's the FR-007 feature, not the hardening).

## References

- Related research: `context/changes/manage-rated-recipes/research.md`
- Rating endpoint template: `src/pages/api/ratings.ts`
- Persist path: `src/pages/api/proposals.ts:161-195`
- History reads: `src/lib/history.ts`
- Card patterns: `src/components/proposals/RecipeCard.tsx`
- S-03 deferral: `supabase/migrations/20260808120000_rate_recipe.sql:33-34`
- Lessons 2 & 4: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Hardening + Schema

#### Automated

- [x] 1.1 `npm run lint` passes — dbe6c63
- [x] 1.2 `npm run test` passes (updated proposals persist tests green) — dbe6c63
- [x] 1.3 `npm run build` passes (env schema accepted) — dbe6c63

#### Manual

- [x] 1.4 Human deploy sequence completed in order: secret → code deploy → `db push` — dbe6c63
- [x] 1.5 Proposals return `recorded: true`; rating a fresh proposal card still succeeds — dbe6c63
- [x] 1.6 Anon-key `recipes` insert rejected — dbe6c63

### Phase 2: API + Data Read

#### Automated

- [x] 2.1 `npm run lint` passes
- [x] 2.2 `npm run test` passes (new DELETE + history tests green)
- [x] 2.3 `npm run build` passes

#### Manual

- [x] 2.4 DELETE returns `deleted: true` then idempotent `deleted: false`; row gone from DB

### Phase 3: UI — Ratings Page + Island

#### Automated

- [ ] 3.1 `npm run lint` passes (react-compiler rule green)
- [ ] 3.2 `npm run test` passes
- [ ] 3.3 `npm run build` passes

#### Manual

- [ ] 3.4 List renders correctly (order, verdicts, image fallback)
- [ ] 3.5 Flip persists non-optimistically and survives reload
- [ ] 3.6 Two-step delete works; blur resets; deletion survives reload
- [ ] 3.7 Deleted recipe proposable again (FR-009 reset)
- [ ] 3.8 Empty state non-error tone (fresh user + last-row delete)
- [ ] 3.9 Nav both ways; signed-out redirect on `/dashboard/ratings`
- [ ] 3.10 Mobile-width rendering pass
