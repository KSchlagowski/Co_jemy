import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

// Module-mock the endpoint's collaborators (the convention from ratings.test.ts): the
// endpoint imports live ESM bindings, so factory mocks are the reliable interception and
// keep `astro:env/server` out of the test graph. `@/lib/proposals` keeps its real exports
// (the endpoint imports SLOT2_STALE_DAYS); only the two builders become spies.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));
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
import { getRecentLikes, getStaleLikes, getDislikedIds, getTopCuisine } from "@/lib/history";
import { buildColdStartSet, buildPersonalizedSet, type ProposedRecipe, type SlottedRecipe } from "@/lib/proposals";
import type { RecentLike, StaleLike } from "@/lib/history";

const createClientMock = vi.mocked(createClient);
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

function slotted(id: number, slot: SlottedRecipe["slot"], requestedCuisine: string | null): SlottedRecipe {
  return { ...proposed(id, requestedCuisine), slot };
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

// Hand-built mock client covering persist(): recipes upsert + proposals insert, both green
// unless a test overrides them.
function mockClient() {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const insert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn((table: string) => (table === "recipes" ? { upsert } : { insert }));
  createClientMock.mockReturnValue({ from } as unknown as ReturnType<typeof createClient>);
  return { upsert, insert, from };
}

// A full personalized set: slots 1/2 by-id re-fetches of liked recipes (no pinned cuisine),
// slots 3/4 from the two searches.
function fullSet(): SlottedRecipe[] {
  return [slotted(42, 1, null), slotted(5, 2, null), slotted(300, 3, "thai"), slotted(400, 4, "french")];
}

beforeEach(() => {
  vi.clearAllMocks();
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
    const cutoff = Date.parse(staleLikes.mock.calls[0][1]);
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
      proposals: { id: number; slot: number; ratingVerdict: string | null; requestedCuisine: string | null }[];
    };
    expect(body.proposals.map((p) => p.slot)).toEqual([1, 2, 3, 4]);
    expect(body.proposals[0]).toMatchObject({ id: 42, ratingVerdict: "like", requestedCuisine: null });
    expect(body.proposals[1]).toMatchObject({ id: 5, ratingVerdict: "like", requestedCuisine: null });
    expect(body.proposals[2]).toMatchObject({ id: 300, ratingVerdict: null, requestedCuisine: "thai" });
    expect(body.proposals[3]).toMatchObject({ id: 400, ratingVerdict: null, requestedCuisine: "french" });
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
    expect(insert).toHaveBeenCalledTimes(1);

    const rows = insert.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.user_id === USER_ID)).toBe(true);
    expect(rows.map((row) => row.spoonacular_id)).toEqual([42, 5, 300, 400]);
    expect(rows.map((row) => row.requested_cuisine)).toEqual([null, null, "thai", "french"]);
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
