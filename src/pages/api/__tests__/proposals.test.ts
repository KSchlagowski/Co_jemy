import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { APIContext } from "astro";
import { POST } from "@/pages/api/proposals";

// The endpoint-level face of risk #1: middleware guards /dashboard, not /api/**, so the
// `if (!user)` check is the only thing between an anonymous request and a spent quota point.
// It must return 401 *before* buildColdStartSet issues any provider call.
describe("POST /api/proposals — auth gate spends zero quota", () => {
  let fetchSpy: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    // Stub fetch so a regression that drops the guard would surface as a real (counted) call.
    fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 401 and makes no provider call for an unauthenticated request", async () => {
    // Minimal APIContext with no `locals.user`; the handler must short-circuit before touching
    // Supabase or the provider, so the other context fields are never read.
    const context = {
      locals: {},
      request: new Request("http://test/api/proposals", { method: "POST" }),
      cookies: {},
    } as unknown as APIContext;

    const res = await POST(context);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, reason: "unauthenticated" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
