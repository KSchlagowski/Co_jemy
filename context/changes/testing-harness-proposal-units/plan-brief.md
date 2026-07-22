# Harness + Proposal-Engine Units (Risk #1) — Plan Brief

> Full plan: `context/changes/testing-harness-proposal-units/plan.md`
> Research: `context/changes/testing-harness-proposal-units/research.md`

## What & Why

Bootstrap the repo's first test runner (Vitest) and turn risk #1 — the
quota/provider-call-count budget — into an automated regression gate. Today the only
protection is a one-time manual attestation ("≈3.40 pts, no extra call leaked"). Once the
shared 50-pt/day Spoonacular budget drains, every user gets HTTP 402 and the app stops
proposing, so a leaked extra call is an app-wide outage.

## Starting Point

No test infrastructure exists — no Vitest, no `test` script, no `*.test.ts`. Every provider
call funnels through one `fetch` choke point (`spoonacular.ts:93`), and `buildColdStartSet`
makes exactly two `searchRecipes` calls today with `getRecipeById` unused. The oracle for
risk #1 is fully specified by the research doc; only the runner mechanics were left to plan.

## Desired End State

`npm test` runs a green suite that goes red the instant a change adds a third provider call,
drops the auth gate, inflates `number`, drops `addRecipeInformation=true`, or breaks the
offset clamp. The runner resolves `astro:env/server` and the `@/` alias with no per-test
wiring, and test-plan §6.1 documents the reusable unit-test pattern.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Scope | Risk #1 only | #4/#5 have no researched oracle yet; research deferred them to their own passes | Research |
| Runner | Vitest via `getViteConfig` (node env) | Sanctioned Astro-native setup; resolves `astro:env/server` + `@/` alias | Plan (Context7) |
| Call-count mock point | Spy the `searchRecipes` wrapper | User choice; proves the two-call invariant + args at the engine layer | Plan |
| Params/clamp mock point | Stub global `fetch` in `searchRecipes`'s own tests | Only seam that sees `addRecipeInformation=true` + the [0,900] clamp | Plan |
| Test layout | `src/**/__tests__/*.test.ts` | User choice; already covered by tsconfig include + lint-staged | Plan |
| Oracle constants | Literals from the PRD (2, 20, 0.035, 3.40) | Importing `PER_CALL` would make a mirror test that passes against a regression | Research |

## Scope

**In scope:** Vitest bootstrap; risk-#1 unit tests (two-call invariant, per-call args,
cost-formula reconciliation, degrade no-leak, provider-edge params, offset clamp,
`not_configured` zero-fetch, auth-gate 401 + zero-fetch); test-plan §6.1 cookbook.

**Out of scope:** Risks #4/#5; MSW / jsdom / `@testing-library`; endpoint-envelope &
persistence integration; Playwright/e2e; CI gate wiring; post-edit hooks; any live
quota-spending test; seeding `Math.random`.

## Architecture / Approach

Three interception layers, each honoring the chosen boundary: **engine** (`vi.mock`
`@/lib/spoonacular` → spy call count + args on `buildColdStartSet`), **provider-edge**
(`vi.stubGlobal("fetch")` → inspect the real request URL in `searchRecipes`'s own tests),
and **endpoint** (fake `APIContext` with no `locals.user` → 401 + zero fetches). All
provider calls are stubbed; the suite spends zero quota.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Runner bootstrap | Vitest config + scripts + setup + smoke test | `astro:env/server` may not resolve under the CF adapter (fallback: `vi.mock`) |
| 2. Two-call invariant | `buildColdStartSet` call-count/args/cost + degrade no-leak | ESM export spying — use `vi.mock` partial, not `vi.spyOn` |
| 3. Edge & auth guards | `searchRecipes` params/clamp + `not_configured` + auth-gate 401 | `not_configured` test is env-sensitive (fallback: drop it) |
| 4. Cookbook + sync | §6.1 pattern + honest rollout status | Status must not read `complete` (risk #1 only) |

**Prerequisites:** Shipped cold-start engine + F-01 cost spike (both present). No new access
needed.
**Estimated effort:** ~1–2 sessions across 4 phases; the bootstrap phase carries the only
real unknown (env-module resolution).

## Open Risks & Assumptions

- `getViteConfig` resolves `astro:env/server` in the node test env — assumed from the Astro
  testing guide; the Phase 1 smoke test verifies it early, with a `vi.mock` fallback.
- The `not_configured` zero-fetch test may be brittle due to the env live-binding; it is
  consciously droppable since the auth-gate test also proves a no-provider-call path.
- The 3.40-pt aggregate is asserted as *structure* (2 calls × number=20 via the formula),
  not as an observed measurement (that stays a live/manual concern).

## Success Criteria (Summary)

- `npm test` is green and wired as a runnable script.
- Each mutation (extra call, inflated `number`, dropped `addRecipeInformation`, weakened
  clamp, removed auth gate) turns a test red.
- Test-plan §6.1 documents the pattern; rollout status honestly shows "risk #1 landed,
  #4/#5 pending."
