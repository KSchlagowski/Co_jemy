import type { APIRoute } from "astro";
import { SPIKE_TOKEN } from "astro:env/server";
import { searchRecipes, getRecipeById } from "@/lib/spoonacular";

// Temporary measurement endpoint for the spoonacular-retrieval-spike change.
// Deleted in Phase 3 — do not build on it.

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET: APIRoute = async (context) => {
  // Middleware leaves /api/* public; an unguarded endpoint on workers.dev would
  // let anyone drain the 50-point daily quota.
  if (!SPIKE_TOKEN || context.request.headers.get("x-spike-token") !== SPIKE_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }

  const params = context.url.searchParams;
  const id = params.get("id");

  const result = id
    ? await getRecipeById(Number(id))
    : await searchRecipes({
        cuisine: params.get("cuisine") ?? undefined,
        number: params.has("number") ? Number(params.get("number")) : undefined,
        offset: params.has("offset") ? Number(params.get("offset")) : undefined,
        sort: params.get("sort") === "random" ? "random" : undefined,
      });

  const status = result.ok
    ? 200
    : result.reason === "quota_exhausted"
      ? 402
      : result.reason === "not_configured"
        ? 503
        : 502;

  return json(result, status);
};
