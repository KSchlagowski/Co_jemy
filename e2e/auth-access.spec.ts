import { test, expect } from "@playwright/test";

/**
 * AUTHORIZATION GATE — positive path (complement to e2e/auth-gate.spec.ts).
 *
 * Protects PRD §Access Control from the OTHER direction: a properly
 * authenticated user must be let THROUGH to /dashboard and see their own
 * personalized content. Together with the unauthenticated test this proves the
 * guard in src/middleware.ts distinguishes a valid session from none — that it
 * is a real check, not an "always redirect".
 *
 * Session source: the shared storageState (playwright/.auth/user.json) written
 * by e2e/auth.setup.ts, which signs in once with E2E_USERNAME / E2E_PASSWORD.
 * The dev server validates that session against Supabase (SUPABASE_URL/KEY from
 * .env), so this test exercises the real supabase.auth.getUser() path — not the
 * unconfigured null branch the local unauthenticated run falls through.
 *
 * Read-only: it navigates and asserts; creates nothing; never signs out (the
 * session in user.json is shared by every test — signing out revokes it).
 */

test("an authenticated user reaches the protected dashboard and sees their own personalized content (PRD §Access Control, src/middleware.ts guard)", async ({
  page,
}) => {
  const email = process.env.E2E_USERNAME ?? "";
  test.skip(!email, "E2E_USERNAME must be set (see .env.example) for the authenticated path.");

  // ACTION — the chromium project injects the authenticated session via
  // storageState; go straight to the protected route with a valid session.
  await page.goto("/dashboard");

  // ASSERTION — the guard lets the valid session through (no redirect back)...
  await expect(page).toHaveURL(/\/dashboard/);

  // ...the personalized dashboard renders, keyed to THIS user's identity (proof
  // the real session was validated, not just any page served)...
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByRole("button", { name: "Get proposals" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  // CLEANUP — none: read-only, creates no user-owned data. Do NOT sign out here;
  // the session in playwright/.auth/user.json is shared by every test.
});
