-- Manage rated recipes (roadmap slice S-04) — FR-007 delete + recipes hardening.
--
-- Two halves:
--
-- (a) FR-007 backend: users can delete a rating, returning the recipe to unrated
--     status. S-03 deliberately withheld the delete grant ("No delete: FR-007 is
--     S-04" — 20260808120000_rate_recipe.sql); this discharges that deferral.
--
-- (b) Lesson-2 hardening (context/foundation/lessons.md): `recipes` was insertable
--     by any authenticated account with `with check (true)`, making it a spoofable
--     first-write-wins shared-trust surface. Now that S-04 renders stored rows back
--     to users, writes move to the server-only service-role client (which bypasses
--     RLS), and the anon-key insert path is revoked. The select grant/policy stay:
--     the ratings list reads recipes via an embedded select.
--
-- Deploy ordering: apply this migration only AFTER the service-role write path is
-- deployed with SUPABASE_SERVICE_ROLE_KEY set — otherwise the deployed persist()
-- loses its insert grant and recipe/rating writes on fresh recipes start failing.

-- (a) FR-007: delete grant + policy, subquery form matching S-03.
grant delete on public.ratings to authenticated;

create policy "users delete their own ratings"
  on public.ratings for delete to authenticated
  using ((select auth.uid()) = user_id);

-- (b) recipes writes are service-role only from here on.
drop policy "recipes are insertable by any authenticated user" on public.recipes;
revoke insert on public.recipes from authenticated;
