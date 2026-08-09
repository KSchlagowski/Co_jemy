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
 * A failed read throws: history is what personalization is built from, and
 * silently treating a read error as "no history" would serve a cold-start set
 * to a user with months of ratings. The endpoint's envelope catch maps the
 * throw to a typed 500.
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
 * Every 👍, most recent first. Unbounded: MVP cardinality is small, and the
 * full id set doubles as the slots-3/4 "already liked never poses as new"
 * exclusion list.
 */
export async function getRecentLikes(client: SessionClient): Promise<RecentLike[]> {
  const { data, error } = await client
    .from("ratings")
    .select("spoonacular_id, rated_at")
    .eq("verdict", "like")
    .order("rated_at", { ascending: false });
  if (error) {
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
 * weeks" — treated as maximally stale, so NULLs sort first.
 */
export async function getStaleLikes(client: SessionClient, cutoffISO: string): Promise<StaleLike[]> {
  const { data, error } = await client
    .from("liked_recipe_history")
    .select("spoonacular_id, rated_at, last_proposed_at")
    .or(`last_proposed_at.lt.${cutoffISO},last_proposed_at.is.null`)
    .order("last_proposed_at", { ascending: true, nullsFirst: true });
  if (error) {
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
 * both the personalized and cold-start paths.
 */
export async function getDislikedIds(client: SessionClient): Promise<number[]> {
  const { data, error } = await client.from("ratings").select("spoonacular_id").eq("verdict", "dislike");
  if (error) {
    throw new Error("history read failed: disliked ids");
  }
  return data.map((row) => row.spoonacular_id as number);
}

/**
 * The user's top affinity cuisine, or null with no cuisine signal. Ties break
 * by most recent proposal event (the decided tie-break rule).
 */
export async function getTopCuisine(client: SessionClient): Promise<string | null> {
  const { data, error } = await client
    .from("cuisine_affinity")
    .select("requested_cuisine, like_events, last_event_at")
    .order("like_events", { ascending: false })
    .order("last_event_at", { ascending: false })
    .limit(1);
  if (error) {
    throw new Error("history read failed: cuisine affinity");
  }
  return data.length > 0 ? (data[0].requested_cuisine as string) : null;
}
