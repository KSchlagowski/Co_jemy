---
date: 2026-08-09T14:45:10+02:00
researcher: Claude Code
git_commit: 6468911ac170dfc1482593c1e817da28a5b021c4
branch: master
repository: Co_jemy
topic: "S-04 manage-rated-recipes — view rated recipes, change a rating, delete a rating (FR-005, FR-006, FR-007)"
tags: [research, codebase, ratings, recipes, rls, quota, ui, manage-rated-recipes]
status: complete
last_updated: 2026-08-09
last_updated_by: Claude Code
---

# Research: S-04 Manage rated recipes (FR-005, FR-006, FR-007)

**Date**: 2026-08-09T14:45:10+02:00
**Researcher**: Claude Code
**Git Commit**: `6468911ac170dfc1482593c1e817da28a5b021c4`
**Branch**: master
**Repository**: Co_jemy

Permalink base: `https://github.com/KSchlagowski/Co_jemy/blob/6468911ac170dfc1482593c1e817da28a5b021c4/`

## Research Question

What exists in the codebase and prior-change record that S-04 (`manage-rated-recipes`, roadmap slice S-04) builds on, and what must be new? Scope: FR-005 (view list of rated recipes), FR-006 (change a rating 👍↔👎), FR-007 (delete a rating, returning the recipe to unrated status).

## Summary

S-04 is smaller on the backend than the three FRs suggest, but it detonates two deferred structural decisions.

1. **FR-006 (change rating) is already fully served at the API/DB layer.** S-03's [`POST /api/ratings`](https://github.com/KSchlagowski/Co_jemy/blob/6468911ac170dfc1482593c1e817da28a5b021c4/src/pages/api/ratings.ts#L60) is an upsert on the composite PK `(user_id, spoonacular_id)` with an UPDATE RLS policy in place — a re-tap flips the verdict in place. S-04 only adds the UI surface for it.
2. **FR-007 (delete) needs new schema and a new endpoint.** The S-03 migration deliberately granted `select, insert, update` but not `delete` — the migration comment says outright "No delete: FR-007 … is S-04, which adds the delete grant + policy" ([20260808120000_rate_recipe.sql:33-34](https://github.com/KSchlagowski/Co_jemy/blob/6468911ac170dfc1482593c1e817da28a5b021c4/supabase/migrations/20260808120000_rate_recipe.sql#L33)). A new migration (grant **and** policy — the repo grants explicitly per command) plus a `DELETE` handler are required. Prod schema pushes are human-only (`npx supabase db push --linked`). Landing FR-007 also unblocks the E2E test plan, which cannot clean up rating rows today.
3. **FR-005 (list view) can and should be served entirely from local data at zero Spoonacular cost.** `ratings.spoonacular_id` has a real FK to `recipes.spoonacular_id`, so one PostgREST embedded select (`ratings` → `recipes(title, image)`) returns everything the DB can legally hold (FR-011: id, title, image). The supporting index `ratings(user_id, rated_at desc)` already exists. Anything beyond those fields costs 1 quota point per recipe — unaffordable against a ~50 pt/day budget where one proposal set already burns ~5.4.
4. **Deferred decision #1 fires: the `recipes` shared-trust hardening.** S-04's list is the first time stored `recipes.title`/`image` rows render back to users — the exact trigger condition in lessons.md lesson 2 and the explicit S-04 prerequisite recorded in S-03's close-out. Any authenticated user can pre-insert a spoofed row via the public anon key; the genuine upsert (`ignoreDuplicates: true`) is silently discarded and no UPDATE policy can repair it. Mitigation (service-role writes or a validating trigger) is net-new infrastructure — no service-role client exists anywhere in the repo.
5. **Deferred decision #2 fires: FR-010 attribution on stored rows.** The DB cannot supply `sourceName`/`sourceUrl` (not in FR-011's three storable fields), so the list either renders without publisher credit/outbound link, or pays 1 pt per recipe live. FR-010's text binds "every proposal"; whether a management list is a proposal surface is a licence-reading judgment call the archives leave open. This is a plan-level decision, not an implementation detail.

On the frontend, the card chrome, image fallback, `safeUrl` hardening, inline-error and in-flight-guard patterns are all directly liftable, but `RatingButton` is a private function, `RecipeCard` hard-couples proposal display with rating POST, there is no nav on authenticated screens, no empty-state precedent, and no dialog primitive for delete confirmation. Route choice matters: `/dashboard/ratings` inherits middleware protection for free; a top-level `/ratings` requires editing `PROTECTED_ROUTES`.

## Detailed Findings

### 1. Database schema — what exists, what's missing

**`public.ratings`** ([20260808120000_rate_recipe.sql:13-22](https://github.com/KSchlagowski/Co_jemy/blob/6468911ac170dfc1482593c1e817da28a5b021c4/supabase/migrations/20260808120000_rate_recipe.sql#L13)):

- Composite PK `(user_id, spoonacular_id)` — no surrogate id; the PK is both the uniqueness rule and the upsert conflict target. DELETE/PATCH must address rows by `spoonacular_id` + session `user_id`, never body-supplied `user_id`.
- `verdict text check in ('like','dislike')`, `rated_at timestamptz default now()`.
- `rated_at` means "when the user last expressed this verdict" — refreshed on every write **including flips**. S-05's slot-1 recency reads it, so a flip from the S-04 list reshuffles slot-1 candidates by design.
- Index `ratings_user_id_rated_at_idx (user_id, rated_at desc)` (`:26-27`) — exactly the access path an `order by rated_at desc` list needs.
- FKs: `auth.users(id) on delete cascade`, `recipes(spoonacular_id)` (no `on delete` clause; `recipes` has no delete grant, so no cascade concerns).
- RLS (`:31-49`): grants `select, insert, update` to `authenticated`; select/insert/update policies all `(select auth.uid()) = user_id` (subquery form is deliberate — planner hoists it). **No DELETE grant, no DELETE policy.**

**`public.recipes`** ([20260720181257_cold_start_proposals.sql:14-19](https://github.com/KSchlagowski/Co_jemy/blob/6468911ac170dfc1482593c1e817da28a5b021c4/supabase/migrations/20260720181257_cold_start_proposals.sql#L14)): exactly the FR-011 three-field set (`spoonacular_id` PK, `title not null`, `image` nullable) + `created_at`. RLS: select `using (true)`, insert `with check (true)` for `authenticated` (`:47-53`) — **no update, no delete**. The migration itself flags the shared-catalogue risk at `:42-44`.

**S-05 views** ([20260809120000_personalized_proposal_slots.sql:28-63](https://github.com/KSchlagowski/Co_jemy/blob/6468911ac170dfc1482593c1e817da28a5b021c4/supabase/migrations/20260809120000_personalized_proposal_slots.sql#L28)): `liked_recipe_history` and `cuisine_affinity`, both `security_invoker = true` (they inherit `ratings` RLS). Both derive from `ratings`, so an S-04 delete automatically resets slot-2 staleness, cuisine affinity, and the FR-009 dislike exclusion — no extra cleanup needed.

**PostgREST cap**: `supabase/config.toml:19` sets `max_rows = 1000`. Lesson 4 ([lessons.md:26-31](https://github.com/KSchlagowski/Co_jemy/blob/6468911ac170dfc1482593c1e817da28a5b021c4/context/foundation/lessons.md#L26)) applies squarely to the S-04 list read: an "unbounded" select silently truncates. Page it, bound it with an explicit `.limit()`, or fetch `count: 'exact'` and fail loudly.

### 2. API layer — endpoint inventory and binding conventions

Existing routes: `POST /api/proposals`, `POST /api/ratings`, and five auth routes. **No GET, PATCH, PUT, or DELETE route exists anywhere in the repo** — S-04 sets the precedent (Astro supports exporting `GET`/`DELETE` from the same route file).

Conventions established by [src/pages/api/ratings.ts](https://github.com/KSchlagowski/Co_jemy/blob/6468911ac170dfc1482593c1e817da28a5b021c4/src/pages/api/ratings.ts) (the template for S-04):

- Envelope `{ ok: true, …payload } | { ok: false, reason }`; local `json()`/`fail()` helpers; `STATUS_BY_REASON` const map (`unauthenticated`→401, `invalid_payload`→400, `unknown_recipe`→404, `service_unavailable`→503, `write_failed`→500; FK violation `23503` → 404).
- Auth: middleware guards `/dashboard` only; **every API route self-checks `context.locals.user` → 401 before constructing a client** (unit-test-asserted at `src/pages/api/__tests__/ratings.test.ts:45-51`). `user_id` always from session, never the body (`:88-98` of the test asserts this).
- Per-request anon-key client via [`createClient(headers, cookies)`](https://github.com/KSchlagowski/Co_jemy/blob/6468911ac170dfc1482593c1e817da28a5b021c4/src/lib/supabase.ts#L5); `null` → 503. **RLS is the sole access-control boundary — no service-role client exists in the repo.**
- Validation: manual `typeof` guards, no zod (deliberate). No generated DB types; queries are string-keyed with per-field `as` casts (`src/lib/history.ts:10-11` records the convention).
- Failure posture: rating writes fail **loudly** (500 `write_failed`) — "persistence is the product here" (S-03 plan). S-04's update/delete should inherit this, unlike proposals' tolerant `recorded:false`.
- Errors never leak Supabase messages; `console.error` is sanitized (code/message, never URLs).
- Wire types: single declaration at the endpoint, type-only re-export to the client (`src/components/proposals/types.ts:9,24`).
- Delete semantics need an explicit decision: Supabase delete returns no error on zero rows, so idempotent-200 vs 404 must be chosen deliberately (e.g. `.select()` on the delete to observe affected rows).

### 3. Data access — the list read

[src/lib/history.ts](https://github.com/KSchlagowski/Co_jemy/blob/6468911ac170dfc1482593c1e817da28a5b021c4/src/lib/history.ts) is the only DB-read module; all functions take `(client, userId, …)`, filter `user_id` explicitly as defense-in-depth, and throw on error. `getRecentLikes` (`:46-62`) is ~80% of the S-04 list query already — minus dislikes, minus `verdict`, minus the recipes join.

The FK from `ratings.spoonacular_id` → `recipes.spoonacular_id` makes a single PostgREST embedded select work with no new view:

```ts
.from("ratings").select("spoonacular_id, verdict, rated_at, recipes(title, image)")
```

(Contrast: S-05 found `ratings ⋈ proposals` embedding impossible because that pair has no FK; the ratings→recipes direction is fine.)

A `recipes` row is guaranteed to exist for every rating: `persist()` upserts the recipe before the proposals row ([src/pages/api/proposals.ts:171-174](https://github.com/KSchlagowski/Co_jemy/blob/6468911ac170dfc1482593c1e817da28a5b021c4/src/pages/api/proposals.ts#L171)), and the ratings endpoint maps the FK violation to 404. Note: a rating can exist with **zero** matching `proposals` rows (no ownership check on the ratings endpoint), so the list cannot assume proposal history.

### 4. UI — reuse map

**Lift directly:** `safeUrl()` (`src/components/proposals/RecipeCard.tsx:24-35`), image-fallback block (`:87`, `:93-108`, gradient tile + `UtensilsCrossed`), credit + "View recipe" link row (`:116-129`), inline error `<p>` pattern (`ProposalError.tsx:28-31`), `useRef` in-flight guard with `finally` release (`RecipeCard.tsx:52-78`), spinner span (`ProposalList.tsx:86`), glass-card page shell (`dashboard.astro:9-15`), Vitest endpoint harness (`src/pages/api/__tests__/ratings.test.ts:1-42`).

**Refactor before reuse:**
- `RatingButton` is a private function inside `RecipeCard.tsx:161-186` (carries the `aria-label`/`aria-pressed` contract) — export it or lift it to a shared module.
- `RecipeCard` hard-couples proposal display with the rating POST; its payload includes `slot`/`excerpt` fields a rated-row doesn't have. Extracting a presentational shell (image + title + credit + children action slot) is the clean split. Its non-optimistic stance — `setVerdict` only after `ok: true`, rationale at `:40-45` ("a 200 is what makes 'persisted' true") — should carry over to flip/delete.
- `ProposalError`'s reason-map pattern: copy, don't inherit its "no retry button" stance (rating ops are quota-free).

**Net new:** the route/page, a nav entry (see §5), `GET` + `DELETE` API handlers, the migration, a `history.ts` list read, an empty state ("no ratings yet" — no precedent component exists; PRD tone guidance at prd.md §US-02: empty states must not feel like errors), and a delete-confirmation UX (no dialog/toast primitive exists — inline two-step confirm or undo affordance are the options that fit the codebase).

**Conventions that bind:** `client:load` is the only hydration directive used; react-compiler ESLint is `error` (existing code has zero `useEffect`s — seed state from props, no sync effects); `void` on async onClick handlers (`no-misused-promises`); app is unconditionally dark-styled — do **not** add `dark:` variants; only `sm:` breakpoints in use; hardcoded palette (purple actions, `text-blue-100/*` text, `text-red-300` errors), the shadcn CSS variables in `global.css` are effectively dead.

### 5. Routing and navigation gaps

- [middleware.ts:4](https://github.com/KSchlagowski/Co_jemy/blob/6468911ac170dfc1482593c1e817da28a5b021c4/src/middleware.ts#L4) protects only `/dashboard` (prefix match). `/dashboard/ratings` is protected for free; `/ratings` requires editing `PROTECTED_ROUTES`. Any new API method still self-gates on `locals.user`.
- **No nav exists on authenticated screens.** `Topbar.astro` is only rendered by the landing page (`Welcome.astro:28`); `dashboard.astro` has no header — a "Rated recipes" link has no existing home. Either render `Topbar` on the dashboard (and add the link at `Topbar.astro:12-21`) or use in-page links.

### 6. The two deferred decisions that fire in S-04

**(a) `recipes` shared-trust hardening — explicit S-04 prerequisite.** Chain of record: accepted in S-02 (plan-review F5), captured as lesson 2, recorded in S-03's close-out as "harden `recipes` open insert policy … before S-04 renders recipes-table rows back to users" (`context/archive/2026-08-08-rate-recipe/change.md:15`), dodged by S-05 by rendering slots 1/2 exclusively from live `getRecipeById` responses (`context/archive/2026-08-08-personalized-proposal-slots/plan.md:31`). S-04's list is precisely "stored rows rendered back to users" — the trigger fires now. Attack shape: open registration + public anon key → any account can pre-insert an arbitrary `spoonacular_id`/`title`/`image`; the genuine upsert uses `ignoreDuplicates: true` and is silently discarded; no UPDATE policy exists to repair the row; the spoofed title/image then renders for *other* users. Documented mitigations: move writes behind a service-role client, or a trigger/check validating rows against the provider payload — **both are net-new infrastructure**. Related: S-05 impl-review F6 spun off an anon-grant-revoke hardening migration (not yet done).

**(b) FR-010 attribution on stored rows.** The list's DB-available fields are id + title + image + verdict + rated_at. `sourceName`/`sourceUrl` are not storable under FR-011 and exist only on live provider responses (`src/lib/spoonacular.ts:6-14`). Re-fetching is 1.00 pt per recipe by id (spike M5) — a 10-item list would burn a fifth of the free plan's daily budget per view, against shipped budgets of 3.40 pt (cold-start) / 5.40 pt (steady-state) per proposal set ≈ 9 sets/day. So the choice is: render the list without publisher credit/outbound link, or pay per row, or something hybrid (e.g. live-fetch a single row on demand). FR-010's licence obligation is written against "proposals"; whether a management list is a proposal surface is a judgment call no archived doc has made. **This must be decided in the plan.**

### 7. Side effects a flip/delete triggers (by design)

- Flip refreshes `rated_at` → reshuffles S-05 slot-1 recency.
- Flip to 👎 makes the recipe permanently FR-009-excluded from proposals (delete is the only escape — which is exactly FR-007's purpose per the PRD).
- Delete instantly resets the FR-009 exclusion and drops the row from both S-05 views (`security_invoker`, derived from `ratings`) — clean single-row delete, no cascade or cleanup work.
- Rating reads/writes and the local list read cost **zero Spoonacular points** under every documented design.

## Code References

- `supabase/migrations/20260808120000_rate_recipe.sql:13-49` — ratings table, index, RLS; `:33-34` the explicit FR-007 deferral ("No delete … S-04 adds the delete grant + policy")
- `supabase/migrations/20260720181257_cold_start_proposals.sql:14-19, 47-53` — recipes three-field schema; open insert policy (the hardening target)
- `supabase/migrations/20260809120000_personalized_proposal_slots.sql:28-63` — S-05 views (auto-reset on delete)
- `supabase/config.toml:19` — `max_rows = 1000` (lesson-4 truncation cap)
- `src/pages/api/ratings.ts:4-104` — envelope, status map, auth gate, upsert (FR-006 already served); the template for S-04's GET/DELETE
- `src/pages/api/proposals.ts:161-195` — `persist()`: recipes upsert with `ignoreDuplicates: true` (the silently-discarded genuine write)
- `src/lib/history.ts:46-62` — `getRecentLikes`, the closest existing read to the S-04 list query
- `src/lib/supabase.ts:5-24` — per-request anon client; no service-role client exists
- `src/middleware.ts:4-22` — `PROTECTED_ROUTES = ["/dashboard"]`, prefix match
- `src/components/proposals/RecipeCard.tsx:24-35, 40-79, 87-108, 116-129, 161-186` — safeUrl, non-optimistic rating call, image fallback, attribution row, private RatingButton
- `src/components/proposals/ProposalList.tsx:28-63, 86, 110` — in-flight guard, fetch/envelope handling, spinner, grid
- `src/components/proposals/ProposalError.tsx:11-31` — reason-map inline error pattern
- `src/components/proposals/types.ts:9, 24` — single-declaration wire-type re-export convention
- `src/components/Topbar.astro:12-21` — the only nav component (not rendered on dashboard)
- `src/pages/dashboard.astro:5-31` — page shell, `client:load` mount, sign-out form
- `src/pages/api/__tests__/ratings.test.ts:7, 32-51, 88-98, 131-140` — endpoint test harness and the assertions that define the conventions

## Architecture Insights

- **RLS is the access-control boundary; endpoints are thin.** Per-request anon client + session `user_id` + explicit `.eq("user_id")` defense-in-depth in reads. No service role anywhere — introducing one (for the recipes hardening) is a deliberate infrastructure decision, not a code tweak.
- **The wire contract has exactly one declaration** (endpoint owns it, client re-exports type-only). Follow for `RatedRecipePayload`.
- **Non-optimistic mutation UI is a product stance, not a style choice** — persistence is the guardrail, so state changes only on `ok: true`.
- **Quota economics rule the design space**: adding calls is expensive, over-fetching within a call is cheap, and anything per-rated-recipe live is unaffordable. The list must render from stored fields.
- **The repo deliberately avoids zod, generated DB types, useEffect, and non-`client:load` hydration.** Deviating from any of these is a decision to surface, not a default.
- **Schema changes are human-applied to prod** (`npx supabase db push --linked`; the linked project is production) — the plan must sequence the migration as a human step.

## Historical Context (from prior changes)

- `context/archive/2026-08-08-rate-recipe/plan.md` — ratings schema rationale (separate from provider-derived `recipes` so a forced purge spares rating events); upsert-as-FR-006; explicit FR-007/S-04 deferral; loud-failure posture.
- `context/archive/2026-08-08-rate-recipe/change.md:15` — the `recipes` hardening named as an S-04 prerequisite.
- `context/archive/2026-08-08-personalized-proposal-slots/plan.md:31` — S-05's deliberate dodge of the hardening (render live fields only, "hardening stays filed with S-04"); `research.md` §6 — E2E rating cleanup impossible until FR-007's DELETE lands (blocks test-plan Phases 3/4).
- `context/archive/2026-07-20-cold-start-proposals/reviews/plan-review.md` F5 — original first-write-wins analysis of the open insert policy.
- `context/archive/2026-07-16-spoonacular-retrieval-spike/findings.md:27` — M5: `getRecipeById` costs exactly 1.00 pt.
- `context/foundation/lessons.md` — lesson 2 (shared-trust recipes table; trigger = S-04's list) and lesson 4 (PostgREST max-rows silent truncation; applies to the list read).

## Related Research

- `context/archive/2026-08-08-personalized-proposal-slots/research.md` — hydration mechanics, history-read conventions, quota budgets.
- `context/archive/2026-07-20-cold-start-proposals/research.md` — FR-011 storage analysis, card field sourcing.

## Open Questions

1. **FR-010 attribution on the list (plan-level decision):** render stored title+image with no publisher credit/link, treat the management list as a non-proposal surface — or pay 1 pt/recipe, or a hybrid (e.g. link out via a live fetch only on user action)? The strict licence reading (prd.md FR-010) vs. quota reality must be reconciled.
2. **`recipes` hardening approach:** service-role client for writes (net-new secret + client path on the Worker) vs. validating trigger/check vs. explicitly re-accepting the risk with a written rationale. Lesson 2 says harden *before* rows become user-visible.
3. **Delete endpoint semantics:** idempotent 200 on zero rows vs. 404 (PostgREST reports no error either way — must be explicit, e.g. `.select()` on the delete).
4. **Delete confirmation UX:** no dialog primitive exists — inline two-step confirm vs. undo affordance.
5. **Navigation placement:** render `Topbar` on authenticated screens (and add the link) vs. simple in-page links between `/dashboard` and the new page.
6. **List bounding:** fixed `.limit()` sized to MVP cardinality vs. real pagination, given the 1000-row silent cap (lesson 4).
7. **Should the UI warn on 👎-flip?** Flipping to dislike from the list permanently excludes the recipe from proposals (FR-009); deletion is the only escape. A silent flip may surprise users.
