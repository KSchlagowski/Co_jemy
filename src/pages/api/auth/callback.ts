import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

/**
 * Turns whatever the confirmation redirect handed the browser into a cookie session.
 *
 * Supabase's default "Confirm signup" template cannot be edited without custom SMTP,
 * so the app cannot route the click through `verifyOtp` (see /api/auth/confirm).
 * Instead `/auth/callback` forwards what it received:
 *   - `code`  — the PKCE authorization code (@supabase/ssr signs up with PKCE)
 *   - tokens  — the implicit-flow fallback, which arrives in a URL fragment the
 *               server can never see
 */
export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response("Supabase is not configured", { status: 500 });
  }

  let body: { code?: unknown; access_token?: unknown; refresh_token?: unknown };
  try {
    body = (await context.request.json()) as typeof body;
  } catch {
    return new Response("Malformed body", { status: 400 });
  }

  const { code, access_token: accessToken, refresh_token: refreshToken } = body;

  if (typeof code === "string") {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return error ? new Response(error.message, { status: 401 }) : new Response(null, { status: 204 });
  }

  if (typeof accessToken === "string" && typeof refreshToken === "string") {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    return error ? new Response(error.message, { status: 401 }) : new Response(null, { status: 204 });
  }

  return new Response("Missing code or tokens", { status: 400 });
};
