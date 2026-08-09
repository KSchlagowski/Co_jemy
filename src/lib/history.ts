import type { createClient } from "@/lib/supabase";

/**
 * All S-05 DB reads in one place: session client in, plain serializable data out.
 * The slot engine (`buildPersonalizedSet`) stays pure by receiving these shapes,
 * and the endpoint stays thin by not owning any query text.
 *
 * Queries are untyped string-keyed per the repo convention (no generated DB
 * types this slice). Aggregation lives in the S-05 SQL views, not here — the
 * Workers CPU-light constraint pushes grouping into Postgres.
 *
 * Every read filters by `user_id` explicitly even though RLS already scopes the
 * session client — the same defense-in-depth posture the ratings write side
 * takes, so a future client swap or policy regression can't silently widen a
 * read to other users' rows.
 *
 * A failed read throws: history is what personalization is built from, and
 * silently treating a read error as "no history" would serve a cold-start set
 * to a user with months of ratings. The endpoint's envelope catch maps the
 * throw to a typed 500; the console marker here is the only trace the failure
 * leaves in Workers observability (Supabase errors carry no secret).
 */

type SessionClient = NonNullable<ReturnType<typeof createClient>>;

export interface RecentLike {
  spoonacularId: number;
  ratedAt: string;
}

export interface StaleLike {
  spoonacularId: number;
  ratedAt: string;
  /** NULL when the like has no recorded proposal event — maximally stale. */
  lastProposedAt: string | null;
}

/**
 * Every 👍, most recent first. No query limit, but NOT truly unbounded:
 * PostgREST silently caps every response at its `max-rows` setting (default
 * 1000) with no error. The id set doubles as the slots-3/4 "already liked
 * never poses as new" exclusion list, so truncation past the cap would let
 * rated recipes re-enter pools. Unreachable at MVP cardinality; add
 * truncation detection before it isn't (see lessons.md).
 */
export async function getRecentLikes(client: SessionClient, userId: string): Promise<RecentLike[]> {
  const { data, error } = await client
    .from("ratings")
    .select("spoonacular_id, rated_at")
    .eq("user_id", userId)
    .eq("verdict", "like")
    .order("rated_at", { ascending: false });
  if (error) {
    // eslint-disable-next-line no-console -- the only trace this failure leaves in Workers observability.
    console.error("history read failed: recent likes", error.code, error.message);
    throw new Error("history read failed: recent likes");
  }
  return data.map((row) => ({
    spoonacularId: row.spoonacular_id as number,
    ratedAt: row.rated_at as string,
  }));
}

/**
 * Likes not proposed since the cutoff, oldest first. A like with no recorded
 * proposal event (NULL last_proposed_at) is literally "not proposed in >= 2
 * weeks" — treated as maximally stale, so NULLs sort first. Takes a `Date` so
 * the safe ISO encoding is structural: the value lands inside a PostgREST
 * `.or()` filter where `,` and `(` are syntax, so a raw string parameter would
 * hand any future caller a filter-injection foot-gun.
 */
export async function getStaleLikes(client: SessionClient, userId: string, cutoff: Date): Promise<StaleLike[]> {
  const cutoffISO = cutoff.toISOString();
  const { data, error } = await client
    .from("liked_recipe_history")
    .select("spoonacular_id, rated_at, last_proposed_at")
    .eq("user_id", userId)
    .or(`last_proposed_at.lt.${cutoffISO},last_proposed_at.is.null`)
    .order("last_proposed_at", { ascending: true, nullsFirst: true });
  if (error) {
    // eslint-disable-next-line no-console -- the only trace this failure leaves in Workers observability.
    console.error("history read failed: stale likes", error.code, error.message);
    throw new Error("history read failed: stale likes");
  }
  return data.map((row) => ({
    spoonacularId: row.spoonacular_id as number,
    ratedAt: row.rated_at as string,
    lastProposedAt: (row.last_proposed_at as string | null) ?? null,
  }));
}

/**
 * The FR-009 exclusion set. Absolute: fetched before every build, applied to
 * both the personalized and cold-start paths. Same PostgREST `max-rows` cap
 * caveat as `getRecentLikes` — a truncated dislike set would violate FR-009
 * silently, which is exactly why the cap is documented here.
 */
export async function getDislikedIds(client: SessionClient, userId: string): Promise<number[]> {
  const { data, error } = await client
    .from("ratings")
    .select("spoonacular_id")
    .eq("user_id", userId)
    .eq("verdict", "dislike");
  if (error) {
    // eslint-disable-next-line no-console -- the only trace this failure leaves in Workers observability.
    console.error("history read failed: disliked ids", error.code, error.message);
    throw new Error("history read failed: disliked ids");
  }
  return data.map((row) => row.spoonacular_id as number);
}

/**
 * The user's top affinity cuisine, or null with no cuisine signal. Ties break
 * by most recent proposal event (the decided tie-break rule).
 */
export async function getTopCuisine(client: SessionClient, userId: string): Promise<string | null> {
  const { data, error } = await client
    .from("cuisine_affinity")
    .select("requested_cuisine, like_events, last_event_at")
    .eq("user_id", userId)
    .order("like_events", { ascending: false })
    .order("last_event_at", { ascending: false })
    .limit(1);
  if (error) {
    // eslint-disable-next-line no-console -- the only trace this failure leaves in Workers observability.
    console.error("history read failed: cuisine affinity", error.code, error.message);
    throw new Error("history read failed: cuisine affinity");
  }
  return data.length > 0 ? (data[0].requested_cuisine as string) : null;
}
