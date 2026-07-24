import { test as setup, expect } from "@playwright/test";
import { STORAGE_STATE } from "../playwright.config";

/**
 * Authenticates once and saves the session to STORAGE_STATE. The `setup`
 * project in playwright.config.ts runs this before the test projects, which
 * then reuse the state via `storageState` instead of logging in each time.
 *
 * Credentials come from the environment (never commit them):
 *   E2E_USERNAME / E2E_PASSWORD — a real Supabase account for the target env.
 */
setup("authenticate", async ({ page }) => {
  const email = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) {
    throw new Error("Set E2E_USERNAME and E2E_PASSWORD (see .env.example) before running E2E tests.");
  }

  await page.goto("/auth/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // A successful sign-in redirects to the dashboard (see src/pages/api/auth/signin.ts).
  await page.waitForURL("/dashboard");
  await expect(page).toHaveURL("/dashboard");

  await page.context().storageState({ path: STORAGE_STATE });
});
