import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { buildColdStartSet, type ProposedRecipe, type ProposalSetResult } from "@/lib/proposals";

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

/** The card-facing shape: sanitized excerpt only — the raw HTML `summary` never crosses to the client. */
interface ProposalPayload {
  id: number;
  title: string;
  image: string | null;
  excerpt: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  spoonacularSourceUrl: string | null;
  requestedCuisine: string;
}

function toPayload(recipe: ProposedRecipe): ProposalPayload {
  return {
    id: recipe.id,
    title: recipe.title,
    image: recipe.image,
    excerpt: recipe.excerpt,
    sourceName: recipe.sourceName,
    sourceUrl: recipe.sourceUrl,
    spoonacularSourceUrl: recipe.spoonacularSourceUrl,
    requestedCuisine: recipe.requestedCuisine,
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
 * Never let a URL or message from the Spoonacular module reach the body — only the typed
 * `reason` code escapes. The key travels as a query param inside that module and stays there.
 */
export const POST: APIRoute = async (context) => {
  // Middleware guards /dashboard, not /api/**, so this check is the only thing between an
  // anonymous request and a spent quota point — it comes before any provider call.
  const user = context.locals.user;
  if (!user) {
    return json({ ok: false, reason: "unauthenticated" }, 401);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ ok: false, reason: "service_unavailable" }, 503);
  }

  const result = await buildColdStartSet();
  if (!result.ok) {
    return json({ ok: false, reason: result.reason }, STATUS_BY_REASON[result.reason]);
  }

  const { proposals, degraded } = result;

  // Persist before responding, but never fail the set on a write error: the quota point is
  // already spent and non-refundable, the recipes are still useful, the row is the retryable
  // part. Recipes land before proposals — the FK points that way.
  const recorded = await persist(supabase, user.id, proposals);

  return json({ ok: true, proposals: proposals.map(toPayload), recorded, degraded }, 200);
};

async function persist(
  supabase: NonNullable<ReturnType<typeof createClient>>,
  userId: string,
  proposals: ProposedRecipe[],
): Promise<boolean> {
  if (proposals.length === 0) {
    return true;
  }

  // Re-proposing a known recipe is the normal path, not an error — ignore conflicts on the id.
  const { error: recipesError } = await supabase.from("recipes").upsert(
    proposals.map((p) => ({ spoonacular_id: p.id, title: p.title, image: p.image })),
    { onConflict: "spoonacular_id", ignoreDuplicates: true },
  );
  if (recipesError) {
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
  return !proposalsError;
}
