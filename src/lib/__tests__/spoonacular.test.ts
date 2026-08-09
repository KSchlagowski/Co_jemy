import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getRecipeById, searchRecipes, type RecipeCandidate, type SpoonacularResult } from "@/lib/spoonacular";

// A 200 response with a `results` array and a plausible quota header block. The tests below
// read only the outbound request `URL`, never the body — but callApi still parses the JSON,
// so it must be valid.
function okResponse(): Response {
  return new Response(JSON.stringify({ results: [] }), {
    status: 200,
    headers: {
      "X-API-Quota-Used": "3.4",
      "X-API-Quota-Request": "1.7",
      "X-API-Quota-Left": "46.6",
    },
  });
}

describe("searchRecipes — risk #1 request-param & clamp guards", () => {
  // This layer is the only seam that observes the params serialized *inside* searchRecipes
  // (addRecipeInformation=true) and the provider offset clamp — a wrapper spy can't see them.
  // Here searchRecipes is the unit under test, so reading its fetch output is not the
  // "mock an internal collaborator" anti-pattern.
  let fetchSpy: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The apiKey travels as a query param; callApi passes a URL object to fetch.
  function requestedUrl(): URL {
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    return fetchSpy.mock.calls[0][0] as URL;
  }

  it("targets complexSearch carrying addRecipeInformation=true and the passed params", async () => {
    await searchRecipes({ cuisine: "italian", number: 20, sort: "random", offset: 5 });

    const url = requestedUrl();
    expect(url.pathname).toBe("/recipes/complexSearch");
    // addRecipeInformation=true is the FR-003 field-completeness guarantee: one call returns
    // every card field, so no second per-recipe lookup leaks a quota point.
    expect(url.searchParams.get("addRecipeInformation")).toBe("true");
    expect(url.searchParams.get("number")).toBe("20");
    expect(url.searchParams.get("cuisine")).toBe("italian");
    expect(url.searchParams.get("sort")).toBe("random");
    expect(url.searchParams.get("apiKey")).toBeTruthy();
  });

  it("never sends nutrition flags (PRD non-goal + extra quota cost)", async () => {
    await searchRecipes({ cuisine: "italian", number: 20 });

    const url = requestedUrl();
    expect(url.searchParams.has("includeNutrition")).toBe(false);
    expect(url.searchParams.has("addRecipeNutrition")).toBe(false);
  });

  // Provider caps offset at 900; a value below 0 or above 900 must be clamped so it can't
  // burn a quota point on a guaranteed-empty request. [0,900] is the provider oracle.
  it.each([
    { offset: -5, expected: "0" },
    { offset: 5000, expected: "900" },
    { offset: 900, expected: "900" },
    { offset: 5, expected: "5" },
  ])("clamps offset $offset into the provider [0,900] range → $expected", async ({ offset, expected }) => {
    await searchRecipes({ cuisine: "italian", number: 20, offset });

    expect(requestedUrl().searchParams.get("offset")).toBe(expected);
  });
});

// Risk #4, tier 1 — the HTTP edge. This is a *different* failure mode from the DB boundary:
// tier 2 fails by an object literal gaining a spread, tier 1 by `RecipeCandidate` gaining a
// field. Neither implies the other, so both are asserted. Fields dropped here never enter the
// app's object graph at all, which is the only reason `requested_cuisine` can be provably
// request-side: the response's `cuisines[]` is structurally unreachable downstream.
describe("the HTTP edge projects only the FR-011 whitelist (risk #4)", () => {
  // The in-memory whitelist, written out from the contract rather than imported: FR-011's three
  // storable fields (id, title, image), FR-010's publisher credit (sourceName, sourceUrl), and
  // the two render-only NFR fields (spoonacularSourceUrl as the dead-link fallback, summary as
  // the excerpt source). In JS default-sort order.
  const CANDIDATE_FIELDS = ["id", "image", "sourceName", "sourceUrl", "spoonacularSourceUrl", "summary", "title"];

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // A payload shaped like a real addRecipeInformation=true result: the seven whitelisted fields
  // plus everything the provider also returns and FR-011 forbids the app from storing in any
  // form — cuisines/dishTypes (the derived classification), nutrition, ingredients, instructions.
  function dirtyRaw(id: number): Record<string, unknown> {
    return {
      id,
      title: `Recipe ${String(id)}`,
      image: `https://img.example/${String(id)}.jpg`,
      summary: `<b>Recipe ${String(id)}</b> has 452 calories and 23g of protein.`,
      sourceName: "Example Kitchen",
      sourceUrl: `https://example.com/${String(id)}`,
      spoonacularSourceUrl: `https://spoonacular.com/recipe/${String(id)}`,
      cuisines: ["thai"],
      dishTypes: ["main course", "dinner"],
      diets: ["gluten free"],
      occasions: ["dinner"],
      nutrition: { nutrients: [{ name: "Calories", amount: 452 }] },
      extendedIngredients: [{ id: 1, name: "chicken" }],
      analyzedInstructions: [{ steps: [{ number: 1, step: "Cook it." }] }],
      pricePerServing: 462,
      healthScore: 61,
    };
  }

  function stubBody(body: unknown): void {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })),
    );
  }

  function recipesOf(result: SpoonacularResult): RecipeCandidate[] {
    if (!result.ok) {
      throw new Error("expected an ok result");
    }
    return result.recipes;
  }

  it("searchRecipes keeps exactly the seven whitelisted fields from a dirty results entry", async () => {
    stubBody({ results: [dirtyRaw(1)] });

    const recipes = recipesOf(await searchRecipes({ cuisine: "italian", number: 20, sort: "random" }));

    expect(recipes).toHaveLength(1);
    // Closed key set: `expect(recipe.cuisines).toBeUndefined()` is an enumeration and would
    // miss whatever the provider adds next.
    expect(Object.keys(recipes[0]).sort()).toEqual(CANDIDATE_FIELDS);
  });

  it("getRecipeById keeps exactly the seven whitelisted fields from a dirty single-object body", async () => {
    // The slots-1/2 re-fetch path — its output reaches persist() too, so the whitelist has to
    // hold on both entry points, not just the search one.
    stubBody(dirtyRaw(42));

    const recipes = recipesOf(await getRecipeById(42));

    expect(recipes).toHaveLength(1);
    expect(Object.keys(recipes[0]).sort()).toEqual(CANDIDATE_FIELDS);
  });
});

describe("searchRecipes — no key means no wasted base point", () => {
  // Forcing the empty-key branch: the astro:env stub reads process.env at module-eval time
  // (test/stubs/astro-env-server.ts), so stubbing the env to "" and re-importing through a
  // reset module graph makes SPOONACULAR_API_KEY empty for the fresh binding.
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("returns not_configured and fires zero fetch calls when the API key is empty", async () => {
    vi.stubEnv("SPOONACULAR_API_KEY", "");
    vi.resetModules();
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchSpy);

    const { searchRecipes: freshSearch } = await import("@/lib/spoonacular");
    const result = await freshSearch({ cuisine: "italian", number: 20, sort: "random" });

    expect(result).toEqual({ ok: false, reason: "not_configured", status: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
