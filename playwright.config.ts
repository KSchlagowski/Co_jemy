import { defineConfig, devices } from "@playwright/test";

/**
 * Astro dev server runs on 4321. Override the target with PLAYWRIGHT_BASE_URL
 * (e.g. to point at a preview deployment) without touching this file.
 */
const PORT = 4321;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * Where the authenticated session is persisted. Gitignored (holds a live
 * Supabase token) — see .gitignore and e2e/auth.setup.ts.
 */
export const STORAGE_STATE = "playwright/.auth/user.json";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    // Signs in once and writes STORAGE_STATE; every other project reuses it,
    // so tests authenticate without driving the login UI each time.
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: STORAGE_STATE,
      },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
