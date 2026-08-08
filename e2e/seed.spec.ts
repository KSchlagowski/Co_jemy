import { test, expect } from "@playwright/test";

/**
 * SEED TEST — the reference pattern for every E2E test in this repo. New tests
 * (human- or agent-written) must follow the four patterns demonstrated below:
 *
 * 1. Role-based selectors. `getByRole` / `getByLabel` / `getByText` — the
 *    user-facing attributes an accessibility snapshot exposes. Never CSS
 *    classes, XPath, or DOM structure; those break on every restyle.
 * 2. Test independence. The full setup → action → assertion → cleanup cycle
 *    lives inside ONE test. Tests run fully parallel in random order — never
 *    assume another test has navigated, clicked, or created anything. Data a
 *    test creates gets a unique id (`Date.now()` suffix, e.g. a sign-up email
 *    `e2e+${Date.now()}@example.com`) and is removed in its own cleanup.
 * 3. Wait for state, never for time. `toBeVisible()`, `waitForURL()`,
 *    `waitForResponse()`. `page.waitForTimeout()` is banned — a test that
 *    waits for time is flaky by construction.
 * 4. Risk-linked naming. The title names the failure scenario the test
 *    protects against, citing its row in context/foundation/test-plan.md.
 *
 * Cost note (test-plan risk #1): each run spends a real proposal set
 * (~2.4–3.4 of the 50 free Spoonacular points/day). Extend THIS flow with
 * more assertions rather than adding more quota-spending tests.
 */

test("every proposal card credits the publisher with a working external link (test-plan risk #6, FR-010)", async ({
  page,
}) => {
  // SETUP — self-contained: navigate fresh; auth comes from the shared storage
  // state written by e2e/auth.setup.ts, not from any other test having signed in.
  await page.goto("/dashboard");
  const getProposals = page.getByRole("button", { name: "Get proposals" });
  await expect(getProposals).toBeVisible();

  // ACTION — register the response wait BEFORE clicking so it can't be missed.
  const proposalsResponse = page.waitForResponse(
    (response) => response.url().includes("/api/proposals") && response.request().method() === "POST",
  );
  await getProposals.click();
  expect((await proposalsResponse).status()).toBe(200);

  // ASSERTION — the risk is a dead-end card: rendered, but with no way out to
  // the publisher (US-01 acceptance: "a working external link" on every card).
  const cards = page.getByRole("article");
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(1);
  expect(count).toBeLessThanOrEqual(4);

  for (const card of await cards.all()) {
    const link = card.getByRole("link", { name: "View recipe" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", /^https?:\/\//);
  }

  // CLEANUP — nothing to remove: this flow creates no user-owned data (the
  // server-side proposal log is not user-managed state). Once ratings land
  // (roadmap S-03), a test that rates a recipe deletes that rating here.
  // Never sign out in cleanup — the session in playwright/.auth/user.json is
  // shared by all tests, and revoking it breaks tests still running in parallel.
});
