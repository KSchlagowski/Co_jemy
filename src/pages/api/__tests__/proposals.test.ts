import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

// Module-mock the endpoint's collaborators (the convention from ratings.test.ts): the
// endpoint imports live ESM bindings, so factory mocks are the reliable interception and
// keep `astro:env/server` out of the test graph. `@/lib/proposals` keeps its real exports
// (the endpoint imports SLOT2_STALE_DAYS); only the two builders become spies.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/history", () => ({
  getRecentLikes: vi.fn(),
  getStaleLikes: vi.fn(),
  getDislikedIds: vi.fn(),
  getTopCuisine: vi.fn(),
}));
vi.mock("@/lib/proposals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/proposals")>();
  return { ...actual, buildColdStartSet: vi.fn(), buildPersonalizedSet: vi.fn() };
});

import { POST } from "@/pages/api/proposals";
import { createClient } from "@/lib/supabase";
import { createAdminClient } from "@/lib/supabase-admin";
import { getRecentLikes, getStaleLikes, getDislikedIds, getTopCuisine } from "@/lib/history";
import { buildColdStartSet, buildPersonalizedSet, type ProposedRecipe, type SlottedRecipe } from "@/lib/proposals";
import type { RecentLike, StaleLike } from "@/lib/history";

const createClientMock = vi.mocked(createClient);
const createAdminClientMock = vi.mocked(createAdminClient);
const recentLikes = vi.mocked(getRecentLikes);
const staleLikes = vi.mocked(getStaleLikes);
const dislikedIds = vi.mocked(getDislikedIds);
const topCuisine = vi.mocked(getTopCuisine);
const coldStart = vi.mocked(buildColdStartSet);
const personalized = vi.mocked(buildPersonalizedSet);

const USER_ID = "11111111-2222-3333-4444-555555555555";

// The stale-cutoff oracle comes from the PRD ("not proposed in ≥2 weeks"), hard-coded here
// rather than imported from SLOT2_STALE_DAYS — importing the constant the endpoint uses
// would make this a mirror test that passes against a regression.
const STALE_CUTOFF_MS = 14 * 24 * 60 * 60 * 1000;

function makeContext(user: { id: string } | null = { id: USER_ID }): APIContext {
  return {
    locals: user ? { user } : {},
    request: new Request("http://test/api/proposals", { method: "POST" }),
    cookies: {},
  } as unknown as APIContext;
}

function proposed(id: number, requestedCuisine: string | null): ProposedRecipe {
  return {
    id,
    title: `Recipe ${String(id)}`,
    image: `https://img.example/${String(id)}.jpg`,
    summary: null,
    sourceName: "Example Kitchen",
    sourceUrl: `https://example.com/${String(id)}`,
    spoonacularSourceUrl: `https://spoonacular.com/recipe/${String(id)}`,
    requestedCuisine,
    excerpt: null,
  };
}

function slotted(
  id: number,
  slot: SlottedRecipe["slot"],
  requestedCuisine: string | null,
  asDesigned = true,
): SlottedRecipe {
  return { ...proposed(id, requestedCuisine), slot, asDesigned };
}

function like(id: number): RecentLike {
  return { spoonacularId: id, ratedAt: "2026-08-09T00:00:00Z" };
}

function stale(id: number): StaleLike {
  return { spoonacularId: id, ratedAt: "2026-07-01T00:00:00Z", lastProposedAt: null };
}

interface HistoryFixture {
  likes?: RecentLike[];
  stales?: StaleLike[];
  dislikes?: number[];
  cuisine?: string | null;
}

function setHistory({ likes = [], stales = [], dislikes = [], cuisine = null }: HistoryFixture = {}): void {
  recentLikes.mockResolvedValue(likes);
  staleLikes.mockResolvedValue(stales);
  dislikedIds.mockResolvedValue(dislikes);
  topCuisine.mockResolvedValue(cuisine);
}

// Hand-built mock clients covering persist(): the recipes upsert now travels on the
// service-role admin client (lesson-2 hardening), the user-scoped proposals insert stays
// on the session client. Both green unless a test overrides them.
function mockClient() {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const insert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn(() => ({ insert }));
  createClientMock.mockReturnValue({ from } as unknown as ReturnType<typeof createClient>);
  const adminFrom = vi.fn(() => ({ upsert }));
  createAdminClientMock.mockReturnValue({ from: adminFrom } as unknown as ReturnType<typeof createAdminClient>);
  return { upsert, insert, from, adminFrom };
}

// A full personalized set: slots 1/2 by-id re-fetches of liked recipes (no pinned cuisine),
// slots 3/4 from the two searches. Slot 4 is marked backfilled so the payload's asDesigned
// passthrough is covered alongside the three designed fills.
function fullSet(): SlottedRecipe[] {
  return [slotted(42, 1, null), slotted(5, 2, null), slotted(300, 3, "thai"), slotted(400, 4, "french", false)];
}

// ——— Risk #4 storage-discipline oracles and deliberately dirty fixtures ———

// FR-011 permits storing exactly a recipe's Spoonacular id, title, and image URL — nothing
// else, "in any derived form" (PRD FR-011). Written out here rather than derived from the
// upsert literal: importing the shape under test is what makes a mirror test. Already in JS
// default-sort order, so it compares directly against `Object.keys(row).sort()`.
const FR011_RECIPE_COLUMNS = ["image", "spoonacular_id", "title"];

// The four app-owned columns of a `proposals` row (test-plan §2 #4, "the app's own request
// facets"; migration 20260720181257_cold_start_proposals.sql:22-30). `requested_cuisine` is the
// cuisine the app *pinned*, never the response's `cuisines[]` — which is what makes it legal to
// store under FR-011. Also in default-sort order.
const PROPOSALS_APP_COLUMNS = ["requested_cuisine", "requested_type", "spoonacular_id", "user_id"];

/**
 * A `ProposedRecipe` carrying every field FR-011 keeps out of the database: the
 * permitted-in-memory ones (`summary`, and `excerpt` — a derived form of `summary`) and the
 * never-parsed provider ones (`cuisines`, `dishTypes`, `nutrition`). A clean fixture cannot
 * fail, which is how a storage test passes green while the leak ships.
 */
function dirtyProposed(id: number, requestedCuisine: string | null): ProposedRecipe {
  // Wider than ProposedRecipe on purpose. Assigned to a variable first — an object literal in
  // the return position would trip the excess-property check, and an `as` cast would trip
  // no-unnecessary-type-assertion.
  const wide = {
    ...proposed(id, requestedCuisine),
    summary: `<b>Recipe ${String(id)}</b> has 452 calories and 23g of protein. <a href="https://spoonacular.com">See more</a>`,
    excerpt: `Recipe ${String(id)}`,
    cuisines: ["thai"],
    dishTypes: ["main course", "dinner"],
    nutrition: { calories: 452 },
  };
  return wide;
}

function dirtySlotted(
  id: number,
  slot: SlottedRecipe["slot"],
  requestedCuisine: string | null,
  asDesigned = true,
): SlottedRecipe {
  return { ...dirtyProposed(id, requestedCuisine), slot, asDesigned };
}

// fullSet()'s shape with deliberately different pins: slot 3 is "italian", not fullSet()'s
// "thai", because "thai" is the value every dirty recipe's `cuisines[]` carries — a pin that
// coincided with it would let a response-sourced column pass by accident. Both pins are inside
// the six measured cuisines (context/archive/2026-07-20-cold-start-proposals/plan.md:162-164).
function dirtyFullSet(): SlottedRecipe[] {
  return [
    dirtySlotted(42, 1, null),
    dirtySlotted(5, 2, null),
    dirtySlotted(300, 3, "italian"),
    dirtySlotted(400, 4, "french", false),
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  // The endpoint now leaves console.error traces on failure paths (impl-review F2);
  // silenced here so deliberate-failure tests don't pollute the runner output.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  setHistory();
  coldStart.mockResolvedValue({ ok: true, proposals: [], degraded: false });
  personalized.mockResolvedValue({ ok: true, proposals: [], degraded: false });
});

// The endpoint-level face of risk #1: middleware guards /dashboard, not /api/**, so the
// `if (!user)` check is the only thing between an anonymous request and a spent quota point.
// It must short-circuit before any history read or builder (= provider) call.
describe("POST /api/proposals — auth gate spends zero quota", () => {
  it("returns 401 and touches neither history nor a builder for an unauthenticated request", async () => {
    const res = await POST(makeContext(null));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, reason: "unauthenticated" });
    expect(createClientMock).not.toHaveBeenCalled();
    expect(recentLikes).not.toHaveBeenCalled();
    expect(coldStart).not.toHaveBeenCalled();
    expect(personalized).not.toHaveBeenCalled();
  });

  it("returns 503 service_unavailable when Supabase is unconfigured, before any history read", async () => {
    createClientMock.mockReturnValue(null);

    const res = await POST(makeContext());

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, reason: "service_unavailable" });
    expect(recentLikes).not.toHaveBeenCalled();
    expect(coldStart).not.toHaveBeenCalled();
  });
});

describe("POST /api/proposals — mode routing", () => {
  it("0 likes → cold start with the FR-009 dislike exclusion, positional slots, null verdicts", async () => {
    mockClient();
    setHistory({ dislikes: [7, 8] });
    coldStart.mockResolvedValue({
      ok: true,
      proposals: [proposed(1, "italian"), proposed(2, "mexican"), proposed(3, "italian")],
      degraded: false,
    });

    const res = await POST(makeContext());

    expect(res.status).toBe(200);
    expect(coldStart).toHaveBeenCalledWith([7, 8]);
    expect(personalized).not.toHaveBeenCalled();

    const body = (await res.json()) as {
      ok: boolean;
      mode: string;
      proposals: { slot: number; ratingVerdict: string | null }[];
    };
    expect(body.mode).toBe("cold_start");
    expect(body.proposals.map((p) => p.slot)).toEqual([1, 2, 3]);
    expect(body.proposals.every((p) => p.ratingVerdict === null)).toBe(true);
    // Positional slots carry no provenance — the client must never badge a cold-start card.
    expect(body.proposals.every((p) => p.asDesigned === false)).toBe(true);
  });

  it("≥1 like → personalized path, fed exactly the four history reads", async () => {
    mockClient();
    const fixture: Required<HistoryFixture> = {
      likes: [like(42), like(5)],
      stales: [stale(5)],
      dislikes: [9],
      cuisine: "thai",
    };
    setHistory(fixture);
    personalized.mockResolvedValue({ ok: true, proposals: fullSet(), degraded: false });

    const res = await POST(makeContext());

    expect(res.status).toBe(200);
    expect(coldStart).not.toHaveBeenCalled();
    expect(personalized).toHaveBeenCalledWith({
      recentLikes: fixture.likes,
      staleLikes: fixture.stales,
      dislikedIds: fixture.dislikes,
      topCuisine: "thai",
    });

    const body = (await res.json()) as { mode: string };
    expect(body.mode).toBe("personalized");
  });

  it("derives the stale cutoff from the PRD's ≥2 weeks", async () => {
    mockClient();
    const before = Date.now();

    await POST(makeContext());

    expect(staleLikes).toHaveBeenCalledTimes(1);
    // Reads carry the session user explicitly (defense-in-depth beside RLS), and the
    // cutoff travels as a Date — the ISO encoding happens inside the history module.
    expect(staleLikes.mock.calls[0][1]).toBe(USER_ID);
    const cutoff = staleLikes.mock.calls[0][2].getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - STALE_CUTOFF_MS);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - STALE_CUTOFF_MS);
  });

  it("issues no build before every history read resolves (history-first ordering)", async () => {
    mockClient();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    recentLikes.mockReturnValue(gate.then(() => []));

    const pending = POST(makeContext());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(coldStart).not.toHaveBeenCalled();
    expect(personalized).not.toHaveBeenCalled();

    release();
    const res = await pending;
    expect(res.status).toBe(200);
    expect(coldStart).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/proposals — payload hydration", () => {
  it("carries slot and ratingVerdict: 'like' on by-id re-fetches of liked recipes, null elsewhere", async () => {
    mockClient();
    setHistory({ likes: [like(42), like(5)], stales: [stale(5)], cuisine: "thai" });
    personalized.mockResolvedValue({ ok: true, proposals: fullSet(), degraded: false });

    const res = await POST(makeContext());

    const body = (await res.json()) as {
      proposals: {
        id: number;
        slot: number;
        ratingVerdict: string | null;
        requestedCuisine: string | null;
        asDesigned: boolean;
      }[];
    };
    expect(body.proposals.map((p) => p.slot)).toEqual([1, 2, 3, 4]);
    expect(body.proposals[0]).toMatchObject({ id: 42, ratingVerdict: "like", requestedCuisine: null });
    expect(body.proposals[1]).toMatchObject({ id: 5, ratingVerdict: "like", requestedCuisine: null });
    expect(body.proposals[2]).toMatchObject({ id: 300, ratingVerdict: null, requestedCuisine: "thai" });
    expect(body.proposals[3]).toMatchObject({ id: 400, ratingVerdict: null, requestedCuisine: "french" });
    // The engine's provenance flag reaches the wire untouched — the backfilled slot 4 stays false.
    expect(body.proposals.map((p) => p.asDesigned)).toEqual([true, true, true, false]);
  });
});

describe("POST /api/proposals — persistence rows", () => {
  it("appends a proposals row for all four slots, NULL cuisine on by-id slots", async () => {
    const { insert, upsert } = mockClient();
    setHistory({ likes: [like(42), like(5)], stales: [stale(5)], cuisine: "thai" });
    personalized.mockResolvedValue({ ok: true, proposals: fullSet(), degraded: false });

    const res = await POST(makeContext());

    expect(res.status).toBe(200);
    expect((await res.json()) as { recorded: boolean }).toMatchObject({ recorded: true });
    expect(upsert).toHaveBeenCalledTimes(1);
    // Repairing upsert: genuine provider data overwrites a pre-existing (possibly spoofed)
    // row — a reappearing ignoreDuplicates would silently undo the lesson-2 hardening.
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: "spoonacular_id" });
    expect(insert).toHaveBeenCalledTimes(1);

    const rows = insert.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.user_id === USER_ID)).toBe(true);
    expect(rows.map((row) => row.spoonacular_id)).toEqual([42, 5, 300, 400]);
    expect(rows.map((row) => row.requested_cuisine)).toEqual([null, null, "thai", "french"]);
  });

  it("tolerates a missing admin client: 200 with recorded:false, no recipes write attempted", async () => {
    // SUPABASE_SERVICE_ROLE_KEY unset degrades persistence, never the set itself.
    const { upsert, insert } = mockClient();
    createAdminClientMock.mockReturnValue(null);
    setHistory({ likes: [like(42), like(5)], stales: [stale(5)], cuisine: "thai" });
    personalized.mockResolvedValue({ ok: true, proposals: fullSet(), degraded: false });

    const res = await POST(makeContext());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; recorded: boolean; proposals: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.recorded).toBe(false);
    expect(body.proposals).toHaveLength(4);
    expect(upsert).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("tolerates a persist failure: 200 with recorded:false, the set still served", async () => {
    // Pins the stated design decision: the quota point is already spent, so a write
    // error must never fail the set — a regression to 500 here would ship silently.
    const { upsert } = mockClient();
    upsert.mockResolvedValue({ error: { code: "XX000", message: "boom" } });
    setHistory({ likes: [like(42), like(5)], stales: [stale(5)], cuisine: "thai" });
    personalized.mockResolvedValue({ ok: true, proposals: fullSet(), degraded: false });

    const res = await POST(makeContext());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; recorded: boolean; proposals: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.recorded).toBe(false);
    expect(body.proposals).toHaveLength(4);
  });
});

// Risk #4, tier 2 — the DB boundary. Forbidden provider fields are already gone by the time
// the endpoint sees a recipe (tier 1 drops them at the HTTP edge, asserted in
// spoonacular.test.ts); what survives in memory is `summary`/`excerpt`/`sourceUrl`, which are
// permitted to render but never to persist. `persist()` receives the *wide* `ProposedRecipe[]`,
// so the only thing keeping them out of a write is a hand-written object literal — a spread
// there would ship them with the rest of the suite green.
describe("POST /api/proposals — FR-011 storage-field discipline (risk #4)", () => {
  async function persistDirtySet() {
    const clients = mockClient();
    setHistory({ likes: [like(42), like(5)], stales: [stale(5)], cuisine: "italian" });
    personalized.mockResolvedValue({ ok: true, proposals: dirtyFullSet(), degraded: false });

    const res = await POST(makeContext());

    expect(res.status).toBe(200);
    return clients;
  }

  it("writes exactly the three FR-011 columns to `recipes`, on the service-role client", async () => {
    const { upsert, adminFrom } = await persistDirtySet();

    // The catalogue write travels on the admin client — `authenticated` no longer holds
    // insert on `recipes` (lesson-2 hardening).
    expect(adminFrom).toHaveBeenCalledWith("recipes");
    expect(upsert).toHaveBeenCalledTimes(1);

    const rows = upsert.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      // A *closed* key set, never per-field `toBeUndefined()`: an enumeration only catches the
      // fields it names, so it misses the next one the provider adds. This is the assertion a
      // `{ ...p }` regression has to get past.
      expect(Object.keys(row).sort()).toEqual(FR011_RECIPE_COLUMNS);
    }
    // …and the three that do land carry the right values.
    expect(rows.map((row) => row.spoonacular_id)).toEqual([42, 5, 300, 400]);
    expect(rows.map((row) => row.title)).toEqual(["Recipe 42", "Recipe 5", "Recipe 300", "Recipe 400"]);
    expect(rows.map((row) => row.image)).toEqual([
      "https://img.example/42.jpg",
      "https://img.example/5.jpg",
      "https://img.example/300.jpg",
      "https://img.example/400.jpg",
    ]);
  });

  it("writes exactly the four app-owned columns to `proposals`, on the session client", async () => {
    const { insert, from } = await persistDirtySet();

    expect(from).toHaveBeenCalledWith("proposals");
    expect(insert).toHaveBeenCalledTimes(1);

    const rows = insert.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      // Closed here too: the existing "persistence rows" test asserts values per column, which
      // an added `summary` column would sail past.
      expect(Object.keys(row).sort()).toEqual(PROPOSALS_APP_COLUMNS);
    }
  });

  it("records the cuisine the app pinned, never the response's contradictory `cuisines[]`", async () => {
    const { insert } = await persistDirtySet();

    const rows = insert.mock.calls[0][0] as Record<string, unknown>[];
    // Every fixture recipe carries `cuisines: ["thai"]` and no pin is "thai", so an endpoint
    // that back-filled the column from the response body would be visibly wrong rather than
    // coincidentally right. This is the endpoint-carriage half of refuting "requested cuisine
    // is a provider recipe field"; the engine-side half (fromById records NULL against a
    // populated by-id `cuisines[]`) can only be observed in lib/__tests__/proposals.test.ts,
    // because this file module-mocks the engine.
    expect(rows.map((row) => row.requested_cuisine)).toEqual([null, null, "italian", "french"]);
    expect(rows.every((row) => row.requested_cuisine !== "thai")).toBe(true);
  });
});

describe("POST /api/proposals — failure mapping on the personalized path", () => {
  it("maps quota_exhausted to 402 and never persists", async () => {
    const { insert, upsert } = mockClient();
    setHistory({ likes: [like(42)] });
    personalized.mockResolvedValue({ ok: false, reason: "quota_exhausted", status: 402 });

    const res = await POST(makeContext());

    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ ok: false, reason: "quota_exhausted" });
    expect(upsert).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("maps a thrown history read to the typed 500 without a builder call", async () => {
    mockClient();
    recentLikes.mockRejectedValue(new Error("history read failed: recent likes"));

    const res = await POST(makeContext());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, reason: "internal_error" });
    expect(coldStart).not.toHaveBeenCalled();
    expect(personalized).not.toHaveBeenCalled();
  });
});
