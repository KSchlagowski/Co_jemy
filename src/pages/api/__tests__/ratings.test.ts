import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

// Module-mock `@/lib/supabase` (the convention from src/lib/__tests__/proposals.test.ts):
// the endpoint imports `createClient` as a live ESM binding, and mocking the whole module
// both intercepts it reliably and keeps the `astro:env/server` import out of the test graph.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

import { POST, DELETE } from "@/pages/api/ratings";
import { createClient } from "@/lib/supabase";

const createClientMock = vi.mocked(createClient);

const USER_ID = "11111111-2222-3333-4444-555555555555";

function makeContext(
  body: BodyInit | null,
  user: { id: string } | null = { id: USER_ID },
  method: "POST" | "DELETE" = "POST",
): APIContext {
  return {
    locals: user ? { user } : {},
    request: new Request("http://test/api/ratings", {
      method,
      body,
      headers: { "Content-Type": "application/json" },
    }),
    cookies: {},
  } as unknown as APIContext;
}

function payload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ spoonacularId: 715538, verdict: "like", ...overrides });
}

// Hand-built mock client: `from("ratings").upsert(...)` resolving to a controllable error.
function mockClient(upsertResult: { error: { code?: string; message?: string } | null }) {
  const upsert = vi.fn().mockResolvedValue(upsertResult);
  const from = vi.fn(() => ({ upsert }));
  createClientMock.mockReturnValue({ from } as unknown as ReturnType<typeof createClient>);
  return { upsert, from };
}

beforeEach(() => {
  createClientMock.mockReset();
});

describe("POST /api/ratings — auth gate", () => {
  it("returns 401 for an unauthenticated request without constructing a Supabase client", async () => {
    const res = await POST(makeContext(payload(), null));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, reason: "unauthenticated" });
    expect(createClientMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/ratings — payload validation", () => {
  it.each([
    ["non-JSON body", "not json {"],
    ["missing spoonacularId", JSON.stringify({ verdict: "like" })],
    ["missing verdict", JSON.stringify({ spoonacularId: 715538 })],
    ["non-integer id", payload({ spoonacularId: 7.5 })],
    ["string id", payload({ spoonacularId: "715538" })],
    ["non-positive id", payload({ spoonacularId: 0 })],
    ["unknown verdict", payload({ verdict: "meh" })],
    ["null body", JSON.stringify(null)],
  ])("returns 400 invalid_payload for %s and never touches the DB", async (_label, body) => {
    const { upsert } = mockClient({ error: null });

    const res = await POST(makeContext(body));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, reason: "invalid_payload" });
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("POST /api/ratings — upsert contract", () => {
  it("returns 503 service_unavailable when Supabase is unconfigured", async () => {
    createClientMock.mockReturnValue(null);

    const res = await POST(makeContext(payload()));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, reason: "service_unavailable" });
  });

  it("upserts on (user_id, spoonacular_id) with session identity and a refreshed rated_at", async () => {
    const { upsert, from } = mockClient({ error: null });
    const before = Date.now();

    // The body tries to smuggle its own user_id; the row must carry the session's instead.
    const res = await POST(makeContext(payload({ user_id: "attacker-id" })));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, verdict: "like" });
    expect(from).toHaveBeenCalledWith("ratings");
    expect(upsert).toHaveBeenCalledTimes(1);

    const [row, options] = upsert.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(row.user_id).toBe(USER_ID);
    expect(row.spoonacular_id).toBe(715538);
    expect(row.verdict).toBe("like");
    expect(options.onConflict).toBe("user_id,spoonacular_id");

    // rated_at is written explicitly on every call (a conflict-update would otherwise keep
    // the original insert time) — assert it is a fresh timestamp, not omitted.
    expect(typeof row.rated_at).toBe("string");
    const ratedAt = Date.parse(row.rated_at as string);
    expect(ratedAt).toBeGreaterThanOrEqual(before);
    expect(ratedAt).toBeLessThanOrEqual(Date.now());
  });

  it("echoes a dislike verdict on success", async () => {
    mockClient({ error: null });

    const res = await POST(makeContext(payload({ verdict: "dislike" })));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, verdict: "dislike" });
  });
});

describe("POST /api/ratings — write failures are loud", () => {
  it("maps an FK violation (unknown recipe) to 404 unknown_recipe", async () => {
    mockClient({ error: { code: "23503", message: "violates foreign key constraint" } });

    const res = await POST(makeContext(payload()));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, reason: "unknown_recipe" });
  });

  it("maps any other DB error to 500 write_failed without leaking the Supabase message", async () => {
    mockClient({ error: { code: "42501", message: "permission denied for table ratings" } });

    const res = await POST(makeContext(payload()));

    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: false, reason: "write_failed" });
    expect(JSON.stringify(body)).not.toContain("permission denied");
  });
});

// Hand-built mock for the delete chain: `.delete().eq().eq().select(...)` resolving to a
// controllable `{ data, error }` (Supabase returns `data: null` alongside an error).
function mockDeleteClient(result: { data: unknown[] | null; error: { code?: string; message?: string } | null }) {
  const select = vi.fn().mockResolvedValue(result);
  const eqSpoonacularId = vi.fn(() => ({ select }));
  const eqUserId = vi.fn(() => ({ eq: eqSpoonacularId }));
  const deleteFn = vi.fn(() => ({ eq: eqUserId }));
  const from = vi.fn(() => ({ delete: deleteFn }));
  createClientMock.mockReturnValue({ from } as unknown as ReturnType<typeof createClient>);
  return { deleteFn, eqUserId, eqSpoonacularId, select, from };
}

function deletePayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ spoonacularId: 715538, ...overrides });
}

describe("DELETE /api/ratings — auth gate", () => {
  it("returns 401 for an unauthenticated request without constructing a Supabase client", async () => {
    const res = await DELETE(makeContext(deletePayload(), null, "DELETE"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, reason: "unauthenticated" });
    expect(createClientMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/ratings — payload validation", () => {
  it.each([
    ["non-JSON body", "not json {"],
    ["missing spoonacularId", JSON.stringify({})],
    ["non-integer id", deletePayload({ spoonacularId: 7.5 })],
    ["string id", deletePayload({ spoonacularId: "715538" })],
    ["non-positive id", deletePayload({ spoonacularId: 0 })],
    ["null body", JSON.stringify(null)],
  ])("returns 400 invalid_payload for %s and never touches the DB", async (_label, body) => {
    const { deleteFn } = mockDeleteClient({ data: [], error: null });

    const res = await DELETE(makeContext(body, { id: USER_ID }, "DELETE"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, reason: "invalid_payload" });
    expect(deleteFn).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/ratings — delete contract", () => {
  it("returns 503 service_unavailable when Supabase is unconfigured", async () => {
    createClientMock.mockReturnValue(null);

    const res = await DELETE(makeContext(deletePayload(), { id: USER_ID }, "DELETE"));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, reason: "service_unavailable" });
  });

  it("deletes by session user_id + spoonacular_id and reports deleted: true when a row went", async () => {
    const { deleteFn, eqUserId, eqSpoonacularId, select, from } = mockDeleteClient({
      data: [{ spoonacular_id: 715538 }],
      error: null,
    });

    // The body tries to smuggle its own user_id; the filter must carry the session's instead.
    const res = await DELETE(makeContext(deletePayload({ user_id: "attacker-id" }), { id: USER_ID }, "DELETE"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: true });
    expect(from).toHaveBeenCalledWith("ratings");
    expect(deleteFn).toHaveBeenCalledTimes(1);
    expect(eqUserId).toHaveBeenCalledWith("user_id", USER_ID);
    expect(eqSpoonacularId).toHaveBeenCalledWith("spoonacular_id", 715538);
    // `.select()` is what observes the affected count — Supabase reports no error on zero rows.
    expect(select).toHaveBeenCalledWith("spoonacular_id");
  });

  it("returns an idempotent 200 with deleted: false when no row matched", async () => {
    mockDeleteClient({ data: [], error: null });

    const res = await DELETE(makeContext(deletePayload(), { id: USER_ID }, "DELETE"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: false });
  });

  it("maps a DB error to 500 write_failed without leaking the Supabase message", async () => {
    mockDeleteClient({ data: null, error: { code: "42501", message: "permission denied for table ratings" } });

    const res = await DELETE(makeContext(deletePayload(), { id: USER_ID }, "DELETE"));

    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: false, reason: "write_failed" });
    expect(JSON.stringify(body)).not.toContain("permission denied");
  });
});
