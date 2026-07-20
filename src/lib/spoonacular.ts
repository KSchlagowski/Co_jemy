import { SPOONACULAR_API_KEY } from "astro:env/server";

const BASE_URL = "https://api.spoonacular.com";

/** Only the fields a proposal card needs — nothing else leaves this module (PRD FR-011). */
export interface RecipeCandidate {
  id: number;
  title: string;
  image: string | null;
  summary: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  spoonacularSourceUrl: string | null;
}

/** Parsed from the X-API-Quota-* response headers — use for runtime budget tracking. */
export interface QuotaInfo {
  used: number;
  request: number;
  left: number;
}

export type SpoonacularResult =
  | { ok: true; recipes: RecipeCandidate[]; quota?: QuotaInfo }
  | {
      ok: false;
      reason: "quota_exhausted" | "http_error" | "not_configured" | "network_error";
      status: number;
      quota?: QuotaInfo;
    };

export interface SearchParams {
  cuisine?: string;
  number?: number;
  offset?: number;
  sort?: "random";
}

function parseQuota(headers: Headers): QuotaInfo | undefined {
  const raw = ["X-API-Quota-Used", "X-API-Quota-Request", "X-API-Quota-Left"].map((h) => headers.get(h));
  if (raw.some((v) => !v)) {
    return undefined;
  }
  const [used, request, left] = raw.map(Number);
  if ([used, request, left].some(Number.isNaN)) {
    return undefined;
  }
  return { used, request, left };
}

function toCandidate(raw: Record<string, unknown>): RecipeCandidate {
  return {
    id: raw.id as number,
    title: raw.title as string,
    image: (raw.image as string | undefined) ?? null,
    summary: (raw.summary as string | undefined) ?? null,
    sourceName: (raw.sourceName as string | undefined) ?? null,
    sourceUrl: (raw.sourceUrl as string | undefined) ?? null,
    spoonacularSourceUrl: (raw.spoonacularSourceUrl as string | undefined) ?? null,
  };
}

// The apiKey travels as a query param, so the full URL is a secret: it is built
// here, sent, and discarded — never logged, thrown, or returned to callers.
async function callApi(
  path: string,
  params: Record<string, string>,
  extract: (body: unknown) => RecipeCandidate[],
): Promise<SpoonacularResult> {
  if (!SPOONACULAR_API_KEY) {
    return { ok: false, reason: "not_configured", status: 0 };
  }

  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("apiKey", SPOONACULAR_API_KEY);

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    // Caught, not rethrown: a thrown fetch error is the one path that could
    // surface the key-bearing URL in Workers observability.
    return { ok: false, reason: "network_error", status: 0 };
  }
  const quota = parseQuota(response.headers);

  if (response.status === 402) {
    return { ok: false, reason: "quota_exhausted", status: 402, quota };
  }
  if (!response.ok) {
    return { ok: false, reason: "http_error", status: response.status, quota };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "network_error", status: response.status, quota };
  }
  return { ok: true, recipes: extract(body), quota };
}

/**
 * GET /recipes/complexSearch with addRecipeInformation=true — one call returns every
 * field a proposal card needs. Nutrition flags are never sent (PRD non-goal + extra cost).
 */
export function searchRecipes(params: SearchParams): Promise<SpoonacularResult> {
  const query: Record<string, string> = { addRecipeInformation: "true" };
  if (params.cuisine) query.cuisine = params.cuisine;
  if (params.number !== undefined) query.number = String(params.number);
  // Provider caps offset at 900; clamp so a bad value can't burn a quota point on a guaranteed error.
  if (params.offset !== undefined) query.offset = String(Math.min(Math.max(params.offset, 0), 900));
  if (params.sort) query.sort = params.sort;

  return callApi("/recipes/complexSearch", query, (body) => {
    const results = (body as { results?: Record<string, unknown>[] }).results ?? [];
    return results.map(toCandidate);
  });
}

/** GET /recipes/{id}/information — the steady-state slots-1/2 re-fetch path. */
export function getRecipeById(id: number): Promise<SpoonacularResult> {
  return callApi(`/recipes/${id}/information`, {}, (body) => [toCandidate(body as Record<string, unknown>)]);
}
