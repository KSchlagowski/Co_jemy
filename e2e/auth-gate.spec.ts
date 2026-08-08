import { test, expect } from "@playwright/test";

/**
 * AUTHORIZATION GATE — protects PRD §Access Control:
 *   "Unauthenticated users cannot access proposals, ratings, or any
 *    personalized content."
 *
 * Risk (browser-level authorization logic; underpins test-plan.md risk #2's
 * per-user isolation — you cannot isolate data an anonymous visitor can reach):
 *   A visitor with NO session reaches /dashboard and sees personalized content
 *   because the app's own route guard in src/middleware.ts (PROTECTED_ROUTES)
 *   fails open.
 *
 * Why E2E (not a unit test): the guard is a cross-boundary flow —
 * browser request → Astro middleware → Supabase session check → server 302 —
 * that only exists in the running app. No isolated function reproduces the
 * middleware + routing + redirect integration.
 *
 * Modeled on e2e/seed.spec.ts: role-based selectors, wait-for-state (never
 * time), self-contained (own setup/action/assertion/cleanup).
 *
 * Cost note (test-plan risk #1): this flow spends NO Spoonacular quota — the
 * gate stops the request before any proposal call, so it is cheap to re-run.
 */

test.describe("authorization gate — unauthenticated access", () => {
  // The chromium project injects an authenticated session via storageState.
  // This risk is specifically about a visitor with NO session, so drop it and
  // start every test in this block from a fresh, anonymous context.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("an unauthenticated visitor to /dashboard is redirected to sign-in and never sees personalized content (PRD §Access Control, src/middleware.ts guard)", async ({
    page,
  }) => {
    // SETUP — self-contained: a fresh anonymous context (storageState emptied
    // above). No prior test has signed in or out; there is nothing to seed.

    // ACTION — request the protected route with no session.
    await page.goto("/dashboard");

    // ASSERTION — the middleware guard redirects the visitor to sign-in...
    await expect(page).toHaveURL(/\/auth\/signin/);

    // ...the personalized dashboard content is never rendered (the actual
    // breach the risk describes: seeing another view than the sign-in page)...
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Get proposals" })).toBeHidden();

    // ...and the sign-in form is what the visitor gets instead.
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    // CLEANUP — none: the flow is read-only and creates no user-owned data. The
    // context is anonymous, so there is no shared session to protect. Never sign
    // out here — the session in playwright/.auth/user.json is shared by all tests.
  });
});
