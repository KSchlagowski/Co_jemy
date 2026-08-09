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

import { buildColdStartSet, buildPersonalizedSet, CUISINES, type PersonalizedHistory } from "@/lib/proposals";
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

// ——— S-05 steady-state fixtures ———

// Steady-state oracle (research §Quota economics; PRD formula 1 + 0.035n):
//   2 searches at number=20 → 2 × 1.70 = 3.40
//   ≤2 by-id re-fetches at 1.00 each (spike measurement M5)
//   full set → 5.40 points ≈ 9 sets/day
// As above: hard-coded from research, never imported from the code under test.
const STEADY_STATE_POINTS = 5.4;
const BY_ID_POINTS = 1;
const POOL_A_BASE = 1000;
const POOL_B_BASE = 2000;

function okById(id: number): SpoonacularResult {
  return { ok: true, recipes: [candidate(id)], quota: { used: 1, request: 1, left: 45 } };
}

function okPool(baseId: number, count = 6): SpoonacularResult {
  return {
    ok: true,
    recipes: Array.from({ length: count }, (_, i) => candidate(baseId + i)),
    quota: { used: 1.7, request: 1.7, left: 45 },
  };
}

function like(id: number): PersonalizedHistory["recentLikes"][number] {
  return { spoonacularId: id, ratedAt: "2026-08-09T00:00:00Z" };
}

function stale(id: number): PersonalizedHistory["staleLikes"][number] {
  return { spoonacularId: id, ratedAt: "2026-07-01T00:00:00Z", lastProposedAt: null };
}

function history(overrides: Partial<PersonalizedHistory> = {}): PersonalizedHistory {
  return { recentLikes: [], staleLikes: [], dislikedIds: [], topCuisine: null, ...overrides };
}

// Full-strength history: slot 1 (recent like 1), slot 2 (stale like 3), slot 3 (5 likes + affinity).
function fullHistory(): PersonalizedHistory {
  return history({
    recentLikes: [like(1), like(2), like(3), like(4), like(5)],
    staleLikes: [stale(3), stale(4)],
    topCuisine: "italian",
  });
}

// By-id echoes the requested id; searches return disjoint known ranges (A then B) so tests
// can tell which pool filled a slot.
function mockSteadyProviders(): void {
  search.mockReset();
  byId.mockReset();
  byId.mockImplementation((id) => Promise.resolve(okById(id)));
  let call = 0;
  search.mockImplementation(() => {
    const result = okPool(call === 0 ? POOL_A_BASE : POOL_B_BASE);
    call += 1;
    return Promise.resolve(result);
  });
}

function expectOk<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) {
    throw new Error("expected an ok result");
  }
  return result as Extract<T, { ok: true }>;
}

describe("buildPersonalizedSet — steady-state budget", () => {
  beforeEach(mockSteadyProviders);

  it("issues exactly two searches (affinity-pinned + a different cuisine) and at most two by-id calls", async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      mockSteadyProviders();

      const result = expectOk(await buildPersonalizedSet(fullHistory()));

      expect(search).toHaveBeenCalledTimes(EXPECTED_CALLS);
      expect(byId.mock.calls.length).toBeLessThanOrEqual(2);

      for (const [params] of search.mock.calls) {
        expect(params.number).toBe(EXPECTED_NUMBER);
        expect(params.sort).toBe("random");
        expect(params.offset).toBeGreaterThanOrEqual(OFFSET_MIN);
        expect(params.offset).toBeLessThanOrEqual(OFFSET_MAX);
        expect(CUISINES).toContain(params.cuisine);
      }

      // Slot 3 pins the affinity cuisine; slot 4 pins a *different* CUISINES member.
      expect(search.mock.calls[0][0].cuisine).toBe("italian");
      expect(search.mock.calls[1][0].cuisine).not.toBe("italian");

      expect(result.proposals).toHaveLength(4);
      expect(result.proposals.map((p) => p.slot)).toEqual([1, 2, 3, 4]);
      // Full-strength history: every slot fills by its own rule, so every badge is earned.
      expect(result.proposals.every((p) => p.asDesigned)).toBe(true);
    }
  });

  it("reconciles a full personalized set to 5.40 points", async () => {
    await buildPersonalizedSet(fullHistory());

    // Predicted from the *observed* calls via the PRD formula plus the measured 1.00-pt
    // by-id cost — adding a call or inflating `number` moves this off 5.40.
    expect(byId).toHaveBeenCalledTimes(2);
    const predicted =
      search.mock.calls.reduce((sum, [params]) => sum + 1 + 0.035 * (params.number ?? 0), 0) +
      byId.mock.calls.length * BY_ID_POINTS;
    expect(predicted).toBeCloseTo(STEADY_STATE_POINTS, 2);
  });
});

describe("buildPersonalizedSet — slot activation thresholds", () => {
  beforeEach(mockSteadyProviders);

  it("0 likes: no by-id calls, no degradation", async () => {
    const result = expectOk(await buildPersonalizedSet(history()));

    expect(byId).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledTimes(EXPECTED_CALLS);
    expect(result.degraded).toBe(false);
  });

  it("1 like: slot 1 re-fetched by id, remaining slots silently pool-filled", async () => {
    const result = expectOk(await buildPersonalizedSet(history({ recentLikes: [like(42)] })));

    expect(byId).toHaveBeenCalledTimes(1);
    expect(byId).toHaveBeenCalledWith(42);

    const [slot1] = result.proposals;
    expect(slot1.slot).toBe(1);
    expect(slot1.id).toBe(42);
    expect(slot1.requestedCuisine).toBeNull();
    expect(result.proposals).toHaveLength(4);
    expect(result.degraded).toBe(false);
    // Slot 1 earned its badge; slot 2 backfilled and slot 3 pinned a random cuisine
    // (inactive profile), so neither may claim provenance; slot 4 filled by its own rule.
    expect(result.proposals.map((p) => p.asDesigned)).toEqual([true, false, false, true]);
  });

  it("a stale like activates slot 2", async () => {
    const result = expectOk(
      await buildPersonalizedSet(history({ recentLikes: [like(1), like(2)], staleLikes: [stale(2)] })),
    );

    expect(byId).toHaveBeenCalledTimes(2);
    expect(byId).toHaveBeenNthCalledWith(2, 2);
    const slot2 = result.proposals.find((p) => p.slot === 2);
    expect(slot2?.id).toBe(2);
  });

  it("slot 3 pins the affinity cuisine only from 5 likes with a cuisine signal", async () => {
    // At the threshold: always pinned.
    expectOk(await buildPersonalizedSet(fullHistory()));
    expect(search.mock.calls[0][0].cuisine).toBe("italian");

    // Below it the cuisine is random, so across many runs it must deviate from the
    // affinity at least once ((1/6)^30 chance of a false red).
    const below = history({
      recentLikes: [like(1), like(2), like(3), like(4)],
      topCuisine: "italian",
    });
    const seen = new Set<string | undefined>();
    for (let i = 0; i < ITERATIONS; i++) {
      mockSteadyProviders();
      await buildPersonalizedSet(below);
      seen.add(search.mock.calls[0][0].cuisine);
    }
    expect([...seen].some((cuisine) => cuisine !== "italian")).toBe(true);
  });
});

describe("buildPersonalizedSet — FR-009 and pool exclusion", () => {
  beforeEach(mockSteadyProviders);

  it("never proposes a 👎-rated recipe, asserted against a non-empty rating history (risk #3)", async () => {
    // Dislikes sit inside both search pools, and a like exists too — the risk-#3
    // anti-pattern is asserting exclusion against an empty rating set.
    const dislikedIds = [POOL_A_BASE, POOL_A_BASE + 1, POOL_B_BASE];
    const result = expectOk(await buildPersonalizedSet(history({ recentLikes: [like(1)], dislikedIds })));

    const ids = result.proposals.map((p) => p.id);
    for (const disliked of dislikedIds) {
      expect(ids).not.toContain(disliked);
    }
    expect(result.proposals).toHaveLength(4);
    expect(result.degraded).toBe(false);
  });

  it("a liked recipe never poses as new in a pool slot", async () => {
    // The like also appears in pool A — it may fill slot 1 (its own by-id), never 3/4.
    const likedInPool = POOL_A_BASE + 2;
    const result = expectOk(await buildPersonalizedSet(history({ recentLikes: [like(likedInPool)] })));

    const occurrences = result.proposals.filter((p) => p.id === likedInPool);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].slot).toBe(1);
  });
});

describe("buildPersonalizedSet — backfill, dedupe, degraded", () => {
  beforeEach(mockSteadyProviders);

  it("a failed by-id backfills from the pool and flags degraded", async () => {
    byId.mockResolvedValueOnce({ ok: false, reason: "http_error", status: 502 });

    const result = expectOk(await buildPersonalizedSet(history({ recentLikes: [like(42)] })));

    expect(result.degraded).toBe(true);
    expect(result.proposals).toHaveLength(4);
    const slot1 = result.proposals.find((p) => p.slot === 1);
    // Pool-filled, not the failed re-fetch — and no compensating extra provider call.
    expect(slot1?.id).toBeGreaterThanOrEqual(POOL_A_BASE);
    expect(slot1?.asDesigned).toBe(false);
    expect(search).toHaveBeenCalledTimes(EXPECTED_CALLS);
    expect(byId).toHaveBeenCalledTimes(1);
  });

  it("slot 2 skips a stale like that duplicates slot 1", async () => {
    const result = expectOk(
      await buildPersonalizedSet(
        history({ recentLikes: [like(7), like(8), like(9)], staleLikes: [stale(7), stale(9)] }),
      ),
    );

    expect(byId).toHaveBeenNthCalledWith(1, 7);
    expect(byId).toHaveBeenNthCalledWith(2, 9);
    const slot2 = result.proposals.find((p) => p.slot === 2);
    expect(slot2?.id).toBe(9);
  });
});

describe("failure-reason preference (quota over transport)", () => {
  beforeEach(() => {
    search.mockReset();
    byId.mockReset();
  });

  it("personalized whole-set failure surfaces quota_exhausted over mixed transport reasons", async () => {
    byId.mockResolvedValue({ ok: false, reason: "network_error", status: 0 });
    search
      .mockResolvedValueOnce({ ok: false, reason: "http_error", status: 502 })
      .mockResolvedValueOnce({ ok: false, reason: "quota_exhausted", status: 402 });

    const result = await buildPersonalizedSet(history({ recentLikes: [like(1)] }));

    expect(result).toEqual({ ok: false, reason: "quota_exhausted", status: 402 });
  });

  it("cold-start double failure surfaces quota_exhausted regardless of call order", async () => {
    search
      .mockResolvedValueOnce({ ok: false, reason: "network_error", status: 0 })
      .mockResolvedValueOnce({ ok: false, reason: "quota_exhausted", status: 402 });

    const result = await buildColdStartSet();

    expect(result).toEqual({ ok: false, reason: "quota_exhausted", status: 402 });
  });
});

describe("buildColdStartSet — FR-009 excludeIds", () => {
  beforeEach(() => {
    search.mockReset();
    byId.mockReset();
    let call = 0;
    search.mockImplementation(() => {
      const result = okResult(call * 100 + 1);
      call += 1;
      return Promise.resolve(result);
    });
  });

  it("filters excluded ids before assembling the set", async () => {
    // Pools are 1..4 and 101..104; excluding three ids still leaves a full set.
    const result = expectOk(await buildColdStartSet([1, 2, 101]));

    const ids = result.proposals.map((p) => p.id);
    expect(ids).toHaveLength(4);
    for (const excluded of [1, 2, 101]) {
      expect(ids).not.toContain(excluded);
    }
  });
});
