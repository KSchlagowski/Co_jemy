import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchRecipes } from "@/lib/spoonacular";

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
