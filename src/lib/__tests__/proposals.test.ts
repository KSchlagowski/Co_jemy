import { describe, it, expect, vi, beforeEach } from "vitest";

// Spy the provider wrapper by mocking the whole module: `proposals.ts` imports
// `searchRecipes` as a live ESM binding, so a `vi.mock` factory that replaces the two
// named exports with `vi.fn()` is the reliable interception (a namespace `vi.spyOn` can
// miss the binding depending on inlining). The real module is loaded via `importOriginal`
// so its types/other exports survive; only the two network entry points become spies.
vi.mock("@/lib/spoonacular", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/spoonacular")>();
  return { ...actual, searchRecipes: vi.fn(), getRecipeById: vi.fn() };
});

import { buildColdStartSet, CUISINES } from "@/lib/proposals";
import { searchRecipes, getRecipeById, type RecipeCandidate, type SpoonacularResult } from "@/lib/spoonacular";

const search = vi.mocked(searchRecipes);
const byId = vi.mocked(getRecipeById);

// The oracle constants come from the PRD/research, never from PER_CALL / MAX_OFFSET:
//   2   — one call per pinned cuisine, cold start pins exactly two cuisines
//   20  — measured over-fetch per call (`number`)
//   0..20 — measured app-side offset window (diversity guard)
//   3.40 — 2 × (1 + 0.035 × 20), the PRD cost formula 1 + 0.035n over two calls
// Hard-coding them here (rather than importing the constants the code uses) is what keeps
// this from becoming a mirror test that passes against a regression.
const EXPECTED_CALLS = 2;
const EXPECTED_NUMBER = 20;
const OFFSET_MIN = 0;
const OFFSET_MAX = 20;
const ITERATIONS = 30;

function candidate(id: number): RecipeCandidate {
  return {
    id,
    title: `Recipe ${String(id)}`,
    image: `https://img.example/${String(id)}.jpg`,
    summary: "A simple weeknight dish.",
    sourceName: "Example Kitchen",
    sourceUrl: `https://example.com/${String(id)}`,
    spoonacularSourceUrl: `https://spoonacular.com/recipe/${String(id)}`,
  };
}

// Four valid candidates + a plausible quota block. The exact ids/quota are irrelevant to the
// call-structure assertions; only the *calls* are inspected, never the response contents.
function okResult(baseId: number): SpoonacularResult {
  return {
    ok: true,
    recipes: [candidate(baseId), candidate(baseId + 1), candidate(baseId + 2), candidate(baseId + 3)],
    quota: { used: 3.4, request: 1.7, left: 46.6 },
  };
}

describe("buildColdStartSet — risk #1 two-call invariant", () => {
  beforeEach(() => {
    search.mockReset();
    byId.mockReset();
    // Distinct id ranges per call so an interleaved two-cuisine set survives dedup — realistic,
    // though the assertions below read only the call args, not the returned proposals.
    let call = 0;
    search.mockImplementation(() => {
      const result = okResult(call * 100 + 1);
      call += 1;
      return Promise.resolve(result);
    });
  });

  it("issues exactly two complexSearch calls, zero by-id calls, with the right per-call args", async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      search.mockClear();
      byId.mockClear();

      await buildColdStartSet();

      // Headline invariant: one call per pinned cuisine, two cuisines → exactly two calls,
      // and never the steady-state per-id re-fetch (scoped to the cold-start path, not global —
      // roadmap S-05 will legitimately introduce getRecipeById elsewhere).
      expect(search).toHaveBeenCalledTimes(EXPECTED_CALLS);
      expect(byId).not.toHaveBeenCalled();

      const calls = search.mock.calls;
      for (const [params] of calls) {
        expect(params.number).toBe(EXPECTED_NUMBER);
        expect(params.sort).toBe("random");
        expect(params.offset).toBeGreaterThanOrEqual(OFFSET_MIN);
        expect(params.offset).toBeLessThanOrEqual(OFFSET_MAX);
        expect(CUISINES).toContain(params.cuisine);
      }

      // Two *distinct* pinned cuisines (US-02's two-cuisine minimum on the request side).
      expect(calls[0][0].cuisine).not.toBe(calls[1][0].cuisine);
    }
  });

  it("reconciles predicted cost to the PRD formula's 3.40 points per set", async () => {
    search.mockClear();

    await buildColdStartSet();

    // Predicted cost is computed from the *observed* per-call `number` via the PRD formula
    // (1 + 0.035n), not from a stored constant — so inflating `number` (or adding a call)
    // moves this off 3.40 and reddens the test. 3.40 is the oracle, not PER_CALL.
    const predicted = search.mock.calls.reduce((sum, [params]) => sum + 1 + 0.035 * (params.number ?? 0), 0);
    expect(predicted).toBeCloseTo(3.4, 2); // 2 × (1 + 0.035 × 20)
  });

  it("degrades on a single failed call without firing a compensating third call", async () => {
    // One call fails (http 502), the other succeeds: the set must degrade to a single cuisine,
    // never retry or issue a make-up call that would spend a third quota point.
    search.mockReset();
    byId.mockReset();
    search.mockResolvedValueOnce({ ok: false, reason: "http_error", status: 502 }).mockResolvedValueOnce(okResult(1));

    const result = await buildColdStartSet();

    expect(result).toMatchObject({ ok: true, degraded: true });
    expect(search).toHaveBeenCalledTimes(EXPECTED_CALLS);
    expect(byId).not.toHaveBeenCalled();
  });
});
