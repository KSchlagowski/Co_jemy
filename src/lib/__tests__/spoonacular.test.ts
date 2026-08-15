import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getRecipeById, searchRecipes } from "@/lib/spoonacular";

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

// The exact whitelist toCandidate may pass: the FR-011 persistable triple (id, title, image),
// FR-010's credit fields (sourceName, sourceUrl), the dead-link NFR's fallback
// (spoonacularSourceUrl), and the live-only summary. Hard-coded in JS default-sort order,
// never imported from the implementation (mirror-test discipline).
const CANDIDATE_FIELDS = ["id", "image", "sourceName", "sourceUrl", "spoonacularSourceUrl", "summary", "title"];

// A provider payload gone maximal: the seven whitelisted fields plus everything FR-011
// forbids the app to hold, in any derived form. A clean payload cannot fail the closed
// key-set assertions below — the dirt is what makes them able to fail.
function dirtyProviderRecipe(): Record<string, unknown> {
  return {
    id: 101,
    title: "Chicken Tikka",
    image: "https://img.example/101.jpg",
    summary: "<b>Chicken Tikka</b> is a main course you can make in 45 minutes.",
    sourceName: "Example Kitchen",
    sourceUrl: "https://example.com/chicken-tikka",
    spoonacularSourceUrl: "https://spoonacular.com/recipe/101",
    cuisines: ["thai"],
    dishTypes: ["main course", "dinner"],
    diets: ["gluten free"],
    occasions: ["fall"],
    nutrition: { nutrients: [{ name: "Calories", amount: 452 }] },
    extendedIngredients: [{ name: "chicken" }],
    analyzedInstructions: [{ steps: [] }],
    pricePerServing: 462.5,
    healthScore: 42,
  };
}

// Risk #4, tier 1 — the HTTP-edge whitelist. A different failure mode from the DB boundary:
// this one fails by RecipeCandidate gaining a field, not by a write-site literal gaining a
// spread. Forbidden provider fields must be dropped here, before they can enter the object graph.
describe("toCandidate — forbidden provider fields dropped at the HTTP edge (FR-011)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("searchRecipes yields candidates carrying exactly the whitelisted keys from a dirty complexSearch body", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify({ results: [dirtyProviderRecipe()] }), { status: 200 })),
    );

    const result = await searchRecipes({ cuisine: "italian", number: 20 });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.recipes).toHaveLength(1);
    expect(Object.keys(result.recipes[0]).sort()).toEqual(CANDIDATE_FIELDS);
  });

  it("getRecipeById strips the same fields from a single-object body — the slots-1/2 re-fetch that also reaches persist()", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(dirtyProviderRecipe()), { status: 200 })),
    );

    const result = await getRecipeById(101);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.recipes).toHaveLength(1);
    expect(Object.keys(result.recipes[0]).sort()).toEqual(CANDIDATE_FIELDS);
  });
});
