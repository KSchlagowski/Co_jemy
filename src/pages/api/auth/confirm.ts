import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const GET: APIRoute = async (context) => {
  const params = new URL(context.request.url).searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type");

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const invalidLink = `/auth/signin?error=${encodeURIComponent("Confirmation link is invalid or has expired")}`;
  if (!tokenHash || !type) {
    return context.redirect(invalidLink);
  }

  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    return context.redirect(invalidLink);
  }

  return context.redirect("/dashboard");
};
