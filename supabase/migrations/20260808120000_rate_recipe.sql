-- Rate recipe (roadmap slice S-03) — the ratings schema.
--
-- ratings is the app's own event data (PRD §Guardrails): who liked or disliked
-- what, when. It is deliberately a separate table from the provider-derived
-- recipes reference (FR-011), so a forced purge of Spoonacular-derived data
-- leaves the user's rating history intact. Only the FK ties them together.
--
-- Deliberately deferred to S-04 (recorded in context/changes/rate-recipe/change.md):
-- hardening the recipes open-insert policy (lessons.md lesson 2 — with check (true)
-- first-write-wins spoofing). S-03 renders live API data only, so recipes rows are
-- still write-only from the user's perspective.

create table if not exists public.ratings (
  user_id uuid not null references auth.users (id) on delete cascade,
  spoonacular_id bigint not null references public.recipes (spoonacular_id),
  verdict text not null check (verdict in ('like', 'dislike')),
  -- "When the user last expressed this verdict" — the upsert refreshes this on
  -- every write, including flips, because S-05's slot 1/2 rules read recency.
  rated_at timestamptz not null default now(),
  -- One rating per user per recipe; also the upsert conflict target.
  primary key (user_id, spoonacular_id)
);

-- Access path for S-05's recency rules (recently liked / not seen >= 2 weeks).
-- Mirrors proposals_user_id_proposed_at_idx.
create index if not exists ratings_user_id_rated_at_idx
  on public.ratings (user_id, rated_at desc);

-- RLS: the database is the access-control boundary — the endpoint writes with
-- the anon key on the user's own cookie session (no service-role client).
alter table public.ratings enable row level security;

-- No delete: FR-007 (delete a rating) is S-04, which adds the delete grant + policy.
grant select, insert, update on public.ratings to authenticated;

-- (select auth.uid()) rather than bare auth.uid(): the subquery form lets the
-- planner hoist the call out of the per-row loop.
create policy "users read their own ratings"
  on public.ratings for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "users insert their own ratings"
  on public.ratings for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "users update their own ratings"
  on public.ratings for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
