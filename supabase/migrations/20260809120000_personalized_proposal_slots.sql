-- Personalized 4-slot proposals (roadmap slice S-05) — the SQL surface for the
-- history-driven slot rules.
--
-- Aggregation lives here rather than in Workers JS (CPU-light constraint): two
-- views give slot 2 ("liked, not proposed >= 2 weeks") and slot 3 (cuisine taste
-- profile) index-backed answers, computed only over data the app itself recorded
-- (requested_cuisine — never the provider's cuisines[], per FR-011).
--
-- Both views MUST be security_invoker: Supabase views are owned by postgres and
-- would otherwise bypass RLS, leaking other users' ratings and proposal history
-- through PostgREST.

-- Slots 1/2 re-fetch recipes by id and pin no cuisine, so by-id proposal events
-- must be able to record honestly. S-02 writes always provide the value, so all
-- existing rows keep it; only the new by-id path inserts NULL.
alter table public.proposals alter column requested_cuisine drop not null;

-- Slot 2's read: per liked recipe, when was it last proposed? proposals is
-- append-only (no update grant, by design), so "last proposed at" is
-- max(proposed_at) over the event log — NULL when a like has no recorded
-- proposal event at all (possible: the ratings endpoint has no ownership check,
-- and recorded:false sets leave gaps).
create view public.liked_recipe_history
  with (security_invoker = true) as
select
  r.user_id,
  r.spoonacular_id,
  r.rated_at,
  max(p.proposed_at) as last_proposed_at
from public.ratings r
left join public.proposals p
  on p.user_id = r.user_id
  and p.spoonacular_id = r.spoonacular_id
where r.verdict = 'like'
group by r.user_id, r.spoonacular_id, r.rated_at;

grant select on public.liked_recipe_history to authenticated;

-- Slot 3's read: which app-requested cuisine do this user's likes cluster in?
-- Counts every proposal event for a liked recipe (the decided aggregation rule);
-- max(proposed_at) implements the most-recent-event tie-break. Cuisine-less
-- (by-id) events are excluded so slot-1/2 re-proposals never pollute the count.
create view public.cuisine_affinity
  with (security_invoker = true) as
select
  p.user_id,
  p.requested_cuisine,
  count(*) as like_events,
  max(p.proposed_at) as last_event_at
from public.proposals p
join public.ratings r
  on r.user_id = p.user_id
  and r.spoonacular_id = p.spoonacular_id
where r.verdict = 'like'
  and p.requested_cuisine is not null
group by p.user_id, p.requested_cuisine;

grant select on public.cuisine_affinity to authenticated;

-- Access path for S-05's liked_recipe_history join: group proposal events by
-- recipe within a user. The existing (user_id, proposed_at) index serves recency
-- lists, not per-recipe grouping.
create index if not exists proposals_user_id_spoonacular_id_proposed_at_idx
  on public.proposals (user_id, spoonacular_id, proposed_at desc);

-- Access path for S-05's FR-009 exclusion read: the 👎 id set fetched before
-- every proposal build. Partial — dislikes are the only verdict this read wants.
create index if not exists ratings_user_id_dislike_idx
  on public.ratings (user_id, spoonacular_id)
  where verdict = 'dislike';
