import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  buildColdStartSet,
  buildPersonalizedSet,
  SLOT2_STALE_DAYS,
  type ProposedRecipe,
  type ProposalSetResult,
} from "@/lib/proposals";
import { getDislikedIds, getRecentLikes, getStaleLikes, getTopCuisine } from "@/lib/history";

type FailureReason = Extract<ProposalSetResult, { ok: false }>["reason"];

// Map the provider's typed failure onto an HTTP status. The spike endpoint's proven
// precedent: quota is a client-visible 402, misconfiguration a 503, anything else a 502.
// The status carried on the result is the raw provider status and never used here.
const STATUS_BY_REASON: Record<FailureReason, number> = {
  quota_exhausted: 402,
  not_configured: 503,
  http_error: 502,
  network_error: 502,
};

/** Which builder assembled the set — the client keys slot badges and degraded copy off this. */
export type ProposalMode = "cold_start" | "personalized";

/**
 * The card-facing shape: sanitized excerpt only — the raw HTML `summary` never crosses to
 * the client. Re-exported by `@/components/proposals/types` so the island and the endpoint
 * share one declaration of the wire contract rather than two hand-synced copies.
 */
export interface ProposalPayload {
  id: number;
  title: string;
  image: string | null;
  excerpt: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  spoonacularSourceUrl: string | null;
  /** Null on by-id re-fetch slots (1/2), which pin no cuisine. */
  requestedCuisine: string | null;
  /** FR-008 slot on a personalized set; positional 1..N on a cold-start set. */
  slot: 1 | 2 | 3 | 4;
  /** The stored verdict for pre-selecting the card's 👍 — a 👎 never ships in a set. */
  ratingVerdict: "like" | null;
  /** False on backfilled/inactive slots — the client only badges a slot filled as designed. */
  asDesigned: boolean;
}

function toPayload(
  recipe: ProposedRecipe,
  slot: ProposalPayload["slot"],
  ratingVerdict: ProposalPayload["ratingVerdict"],
  asDesigned: boolean,
): ProposalPayload {
  return {
    id: recipe.id,
    title: recipe.title,
    image: recipe.image,
    excerpt: recipe.excerpt,
    sourceName: recipe.sourceName,
    sourceUrl: recipe.sourceUrl,
    spoonacularSourceUrl: recipe.spoonacularSourceUrl,
    requestedCuisine: recipe.requestedCuisine,
    slot,
    ratingVerdict,
    asDesigned,
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * The first session-authenticated JSON endpoint in the repo. Composes retrieval with
 * persistence and defines the envelope later endpoints inherit.
 *
 * History reads come before any provider call — DB reads are quota-free, provider calls
 * are not, and the mode decision needs the like set anyway. A failed history read throws
 * into the envelope catch: silently serving cold start to a user with months of ratings
 * is worse than a retryable 500.
 *
 * Never let a URL or message from the Spoonacular module reach the body — only the typed
 * `reason` code escapes. The key travels as a query param inside that module and stays there.
 */
export const POST: APIRoute = async (context) => {
  try {
    // Middleware guards /dashboard, not /api/**, so this check is the only thing between an
    // anonymous request and a spent quota point — it comes before any history or provider call.
    const user = context.locals.user;
    if (!user) {
      return json({ ok: false, reason: "unauthenticated" }, 401);
    }

    const supabase = createClient(context.request.headers, context.cookies);
    if (!supabase) {
      return json({ ok: false, reason: "service_unavailable" }, 503);
    }

    const cutoff = new Date(Date.now() - SLOT2_STALE_DAYS * 24 * 60 * 60 * 1000);
    const [recentLikes, staleLikes, dislikedIds, topCuisine] = await Promise.all([
      getRecentLikes(supabase, user.id),
      getStaleLikes(supabase, user.id, cutoff),
      getDislikedIds(supabase, user.id),
      getTopCuisine(supabase, user.id),
    ]);

    const mode: ProposalMode = recentLikes.length > 0 ? "personalized" : "cold_start";

    let proposals: ProposedRecipe[];
    let payloads: ProposalPayload[];
    let degraded: boolean;

    if (mode === "personalized") {
      const result = await buildPersonalizedSet({ recentLikes, staleLikes, dislikedIds, topCuisine });
      if (!result.ok) {
        return json({ ok: false, reason: result.reason }, STATUS_BY_REASON[result.reason]);
      }
      // Liked ids never enter the search pools, so a liked id in the set can only be its own
      // slot-1/2 by-id re-fetch — the verdict derives from construction, no extra DB read.
      const likedIds = new Set(recentLikes.map((l) => l.spoonacularId));
      proposals = result.proposals;
      degraded = result.degraded;
      payloads = result.proposals.map((p) => toPayload(p, p.slot, likedIds.has(p.id) ? "like" : null, p.asDesigned));
    } else {
      const result = await buildColdStartSet(dislikedIds);
      if (!result.ok) {
        return json({ ok: false, reason: result.reason }, STATUS_BY_REASON[result.reason]);
      }
      proposals = result.proposals;
      degraded = result.degraded;
      // Cold-start slots are positional: the set caps at 4, so index + 1 stays in the union.
      // Positional slots have no provenance to badge, so asDesigned is uniformly false.
      payloads = result.proposals.map((p, i) => toPayload(p, (i + 1) as ProposalPayload["slot"], null, false));
    }

    // Persist before responding, but never fail the set on a write error: the quota point is
    // already spent and non-refundable, the recipes are still useful, the row is the retryable
    // part. Recipes land before proposals — the FK points that way. Personalized sets append
    // rows for all four slots; by-id slots record a NULL cuisine, which is what keeps slot 2's
    // max(proposed_at) semantics honest without polluting the affinity count.
    const recorded = await persist(supabase, user.id, proposals);

    return json({ ok: true, mode, proposals: payloads, recorded, degraded }, 200);
  } catch (error) {
    // The envelope is the convention later endpoints inherit, so nothing escapes untyped.
    // Logged before mapping — a silent 500 is undiagnosable in Workers observability — with
    // the apiKey query param redacted: an unexpected throw is the one path that could carry
    // the key-bearing provider URL.
    const message = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line no-console -- the only trace a production 500 leaves.
    console.error("proposals: unhandled failure —", message.replace(/apiKey=[^&\s"']+/gi, "apiKey=REDACTED"));
    return json({ ok: false, reason: "internal_error" }, 500);
  }
};

async function persist(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  userId: string,
  proposals: ProposedRecipe[],
): Promise<boolean> {
  if (proposals.length === 0) {
    return true;
  }

  // The catalogue write goes through the service-role client: `authenticated` no longer
  // holds insert on `recipes` (lesson-2 hardening), and the repairing upsert — no
  // ignoreDuplicates — lets genuine provider data overwrite any pre-existing (possibly
  // spoofed) row and refresh stale titles/images. A missing admin client degrades to the
  // same tolerant recorded:false path as any other persist failure.
  const admin = createAdminClient();
  if (!admin) {
    // eslint-disable-next-line no-console -- recorded:false is silent by design; this is its only trace.
    console.error(
      "proposals persist: admin client unavailable (SUPABASE_SERVICE_ROLE_KEY unset) — fresh recipes will not land in `recipes`, so rating them FK-404s unknown_recipe until the key is set",
    );
    return false;
  }

  const { error: recipesError } = await admin.from("recipes").upsert(
    proposals.map((p) => ({ spoonacular_id: p.id, title: p.title, image: p.image })),
    { onConflict: "spoonacular_id" },
  );
  if (recipesError) {
    // eslint-disable-next-line no-console -- recorded:false is silent by design; this is its only trace.
    console.error("proposals persist: recipes upsert failed", recipesError.code, recipesError.message);
    return false;
  }

  const { error: proposalsError } = await supabase.from("proposals").insert(
    proposals.map((p) => ({
      user_id: userId,
      spoonacular_id: p.id,
      requested_cuisine: p.requestedCuisine,
      requested_type: null,
    })),
  );
  if (proposalsError) {
    // eslint-disable-next-line no-console -- recorded:false is silent by design; this is its only trace.
    console.error("proposals persist: rows insert failed", proposalsError.code, proposalsError.message);
    return false;
  }
  return true;
}
