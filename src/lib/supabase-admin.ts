import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "astro:env/server";

/**
 * The repo's only service-role client, used exclusively for the `recipes` catalogue
 * upsert. `recipes` is written by the app but read by *other* users, so anon-key
 * writes made it a shared-trust surface (lessons.md lesson 2: `with check (true)`
 * meant first write wins, spoofable by any account). Routing the write through the
 * service role — and revoking the `authenticated` insert — closes that.
 *
 * This client BYPASSES RLS entirely. It must never be handed request-scoped or
 * user-scoped work: anything keyed on a user id stays on the session client from
 * `@/lib/supabase`, where RLS is the access-control boundary.
 */
export function createAdminClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  return createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
