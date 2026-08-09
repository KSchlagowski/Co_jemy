import { describe, it, expect, vi, beforeEach } from "vitest";

import { getRatedRecipes } from "@/lib/history";
import type { createClient } from "@/lib/supabase";

type SessionClient = NonNullable<ReturnType<typeof createClient>>;

const USER_ID = "11111111-2222-3333-4444-555555555555";

interface RatedRow {
  spoonacular_id: number;
  verdict: string;
  rated_at: string;
  recipes: { title: string; image: string | null } | null;
}

// Hand-built chainable mock for the embedded list read:
// `.from().select().eq().order().limit()` resolving to a controllable `{ data, error }`.
function makeClient(result: { data: RatedRow[] | null; error: { code?: string; message?: string } | null }) {
  const limit = vi.fn().mockResolvedValue(result);
  const order = vi.fn(() => ({ limit }));
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as unknown as SessionClient, from, select, eq, order, limit };
}

function row(overrides: Partial<RatedRow> = {}): RatedRow {
  return {
    spoonacular_id: 715538,
    verdict: "like",
    rated_at: "2026-08-09T10:00:00.000Z",
    recipes: { title: "Pasta", image: "https://img.spoonacular.com/715538.jpg" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("getRatedRecipes — query shape", () => {
  it("selects the embedded recipes fields, scoped to the user, newest first, bounded at 100", async () => {
    const { client, from, select, eq, order, limit } = makeClient({ data: [], error: null });

    await getRatedRecipes(client, USER_ID);

    expect(from).toHaveBeenCalledWith("ratings");
    expect(select).toHaveBeenCalledWith("spoonacular_id, verdict, rated_at, recipes(title, image)");
    expect(eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(order).toHaveBeenCalledWith("rated_at", { ascending: false });
    expect(limit).toHaveBeenCalledWith(100);
  });
});

describe("getRatedRecipes — row mapping", () => {
  it("flattens the embed into RatedRecipe rows in response order", async () => {
    const { client } = makeClient({
      data: [
        row({ spoonacular_id: 2, verdict: "dislike", rated_at: "2026-08-09T12:00:00.000Z" }),
        row({ spoonacular_id: 1, recipes: { title: "Soup", image: null } }),
      ],
      error: null,
    });

    const rated = await getRatedRecipes(client, USER_ID);

    expect(rated).toEqual([
      {
        spoonacularId: 2,
        verdict: "dislike",
        ratedAt: "2026-08-09T12:00:00.000Z",
        title: "Pasta",
        image: "https://img.spoonacular.com/715538.jpg",
      },
      {
        spoonacularId: 1,
        verdict: "like",
        ratedAt: "2026-08-09T10:00:00.000Z",
        title: "Soup",
        image: null,
      },
    ]);
  });

  it("skips (and logs) a row with a null embed instead of crashing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client } = makeClient({
      data: [row({ spoonacular_id: 9, recipes: null }), row({ spoonacular_id: 1 })],
      error: null,
    });

    const rated = await getRatedRecipes(client, USER_ID);

    expect(rated).toHaveLength(1);
    expect(rated[0].spoonacularId).toBe(1);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});

describe("getRatedRecipes — failure posture", () => {
  it("throws on a read error without leaking the Supabase message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client } = makeClient({
      data: null,
      error: { code: "42501", message: "permission denied for table ratings" },
    });

    await expect(getRatedRecipes(client, USER_ID)).rejects.toThrow("history read failed: rated recipes");
  });
});
