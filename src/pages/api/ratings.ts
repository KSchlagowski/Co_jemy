import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export type RatingVerdict = "like" | "dislike";

type FailureReason = "unauthenticated" | "invalid_payload" | "service_unavailable" | "unknown_recipe" | "write_failed";

const STATUS_BY_REASON: Record<FailureReason, number> = {
  unauthenticated: 401,
  invalid_payload: 400,
  service_unavailable: 503,
  unknown_recipe: 404,
  write_failed: 500,
};

// Postgres foreign-key violation: the body named a spoonacular_id with no `recipes` row.
// Every recipe a user has ever been shown has one (proposals upserts it first), so this is
// a client error worth its own reason, not a server fault.
const FK_VIOLATION = "23503";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fail(reason: FailureReason): Response {
  return json({ ok: false, reason }, STATUS_BY_REASON[reason]);
}

interface RatingPayload {
  spoonacularId: number;
  verdict: RatingVerdict;
}

function parsePayload(body: unknown): RatingPayload | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { spoonacularId, verdict } = body as Record<string, unknown>;
  if (typeof spoonacularId !== "number" || !Number.isInteger(spoonacularId) || spoonacularId <= 0) {
    return null;
  }
  if (verdict !== "like" && verdict !== "dislike") {
    return null;
  }
  return { spoonacularId, verdict };
}

/**
 * Upsert the caller's 👍/👎 for a recipe. Inherits the proposals envelope; single DB write,
 * no provider calls, zero quota cost.
 *
 * Unlike proposals' tolerant `recorded: false`, a failed write fails the request loudly —
 * the UI's wait-for-server contract depends on a 200 meaning "persisted" (PRD §Guardrails).
 * `rated_at` is refreshed on every write, including verdict flips: it means "when the user
 * last expressed this verdict", the recency signal S-05's slot rules read.
 */
export const POST: APIRoute = async (context) => {
  try {
    // Middleware guards /dashboard, not /api/** — this check is the endpoint's own gate.
    const user = context.locals.user;
    if (!user) {
      return fail("unauthenticated");
    }

    let body: unknown;
    try {
      body = await context.request.json();
    } catch {
      return fail("invalid_payload");
    }
    const payload = parsePayload(body);
    if (!payload) {
      return fail("invalid_payload");
    }

    const supabase = createClient(context.request.headers, context.cookies);
    if (!supabase) {
      return fail("service_unavailable");
    }

    // user_id comes from the session, never the body — RLS would reject a mismatch anyway,
    // but the row must not even be attempted with client-supplied identity.
    const { error } = await supabase.from("ratings").upsert(
      {
        user_id: user.id,
        spoonacular_id: payload.spoonacularId,
        verdict: payload.verdict,
        rated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,spoonacular_id" },
    );

    if (error) {
      return fail(error.code === FK_VIOLATION ? "unknown_recipe" : "write_failed");
    }

    return json({ ok: true, verdict: payload.verdict }, 200);
  } catch {
    // Envelope convention: nothing escapes untyped (matches proposals.ts).
    return json({ ok: false, reason: "internal_error" }, 500);
  }
};
