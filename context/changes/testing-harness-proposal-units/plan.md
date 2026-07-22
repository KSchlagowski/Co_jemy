# Harness + Proposal-Engine Units (Risk #1) Implementation Plan

## Overview

Bootstrap the project's first test runner (Vitest) and convert risk #1's
one-time manual attestation (`cold-start-proposals/verification.md` §5.6,
"≈3.40 pts — no extra provider call leaked") into an automated **regression
gate**. Risk #1 is the quota/provider-call-count budget: a cold-start proposal
set must issue **exactly two** `complexSearch` calls and **zero** other provider
calls, or the shared 50-pt/day free budget drains and every user gets HTTP 402.

**Scope is risk #1 only.** Test-plan §3 names Phase 1 as covering risks #1, #4,
and #5, but the research pass (`research.md`) produced a grounded oracle for #1
alone and explicitly deferred #4 (storage-field discipline) and #5 (request-side
diversity) to "their own research when their sub-phases open." Per the oracle
rules, tests without a researched oracle risk becoming mirror tests, so #4/#5 are
out of this plan and reopen with their own `/10x-research`.

## Current State Analysis

- **No test infrastructure exists.** No Vitest / MSW / `@testing-library` / jsdom,
  no `test` script, no `*.test.ts` anywhere in the repo
  ([package.json:5-13,36-56](package.json)). Bootstrapping the runner is part of
  this phase.
- **A single provider `fetch` choke point.** Every real Spoonacular call funnels
  through `callApi` → `fetch(url)` ([spoonacular.ts:93](src/lib/spoonacular.ts:93)),
  gated by `SPOONACULAR_API_KEY` from the `astro:env/server` virtual module
  ([spoonacular.ts:1,81](src/lib/spoonacular.ts:1)).
- **Two live call sites, both in `buildColdStartSet`.** `searchRecipes` is called
  exactly twice ([proposals.ts:207-208](src/lib/proposals.ts:207)), one per pinned
  cuisine from `pickCuisinePair` ([proposals.ts:156](src/lib/proposals.ts:156));
  `getRecipeById` (the future steady-state per-id re-fetch) has **zero** call sites
  today ([spoonacular.ts:136](src/lib/spoonacular.ts:136)).
- **Params live at two layers.** `number: 20`, `sort: "random"`, `offset` (0–20 via
  `randomOffset`), and the pinned `cuisine` are passed *into* `searchRecipes` from
  `buildColdStartSet`; `addRecipeInformation=true` and the provider [0,900] `offset`
  clamp are serialized *inside* `searchRecipes`
  ([spoonacular.ts:122,126](src/lib/spoonacular.ts:122)).
- **Auth gate precedes any provider call.** `POST /api/proposals` returns 401 before
  `buildColdStartSet` runs ([api/proposals.ts:59-69](src/pages/api/proposals.ts:59)),
  so an anonymous request spends zero quota — a distinct leak face of risk #1.
- **Env schema is declared.** `SPOONACULAR_API_KEY` is a server/secret/**optional**
  field ([astro.config.mjs:21](astro.config.mjs:21)); `optional: true` is why the
  runtime guards `if (!SPOONACULAR_API_KEY)`. (CLAUDE.md's "not yet declared" note is
  stale.)
- **`@/` alias** maps to `./src/*` ([tsconfig.json:10](tsconfig.json:10)); eslint runs
  `strictTypeChecked` with `projectService` over all TS files
  ([eslint.config.js:14-38](eslint.config.js:14)); lint-staged auto-fixes
  `*.{ts,tsx,astro}` on commit.

## Desired End State

`npm test` runs a green Vitest suite that fails the moment a code change (a) adds a
third provider call to a cold-start set, (b) drops the auth gate, (c) inflates
`number` past 20, (d) drops `addRecipeInformation=true`, or (e) breaks the [0,900]
offset clamp. The runner resolves the `astro:env/server` virtual module and the `@/`
alias with no per-test wiring, and test-plan §6.1 documents the reusable unit-test
pattern. Verify by running `npm test` (green), then temporarily changing `PER_CALL`
to `40` in a scratch edit and confirming the two-call/cost tests go red.

### Key Discoveries

- **`getViteConfig()` from `astro/config` is the sanctioned Vitest harness** — it
  loads the Astro config, so `astro:env/server` resolves and tsconfig `@/` paths carry
  into Vite (Context7, Astro testing guide). Astro 6 requires the **`node`** test
  environment.
- **The oracle constants come from the PRD/research, not the code.** `2` (one call per
  pinned cuisine × 2 cuisines), `20` (`number`), `1 + 0.035n` (cost formula), `3.40`
  (2 × (1 + 0.035×20)), `[0,20]` (measured app cap), `[0,900]` (provider cap) — all
  from `research.md` "The oracle for the Phase 1 unit test", never read from `PER_CALL`
  / `MAX_OFFSET`.
- **Scope the by-id assertion to the cold-start path.** Assert `buildColdStartSet`
  makes zero `getRecipeById` calls — never a global "the app never calls
  `getRecipeById`", which roadmap S-05 will legitimately break (`research.md` "two
  faces of risk #1").
- **Assert call structure, not observed points.** The unit layer asserts `2 calls ×
  number=20`, from which 3.40 follows *by the formula*; it must not hard-assert "3.40
  observed" (that depends on how many recipes each call returns — a live concern
  already attested by §5.6).

## What We're NOT Doing

- **Risk #4** (only id/title/image persisted) and **risk #5** (≥2 distinct *requested*
  cuisines) — deferred to their own `/10x-research` + plan; they reopen this rollout
  phase later.
- **MSW, jsdom, `@testing-library`** — those are test-rollout Phase 2 tools
  (test-plan §4). Phase 1 uses Vitest's own spy/stub only.
- **The full `/api/proposals` envelope + persistence integration** — test-rollout
  Phase 2. Here we test only the auth-gate leak face at unit level.
- **Playwright / e2e** (rollout Phase 4), **CI gate wiring** (rollout Phase 4 + the
  CLAUDE.md lesson boundary "do not author CI/CD pipelines"), **post-edit hooks**
  (Lesson 3). Phase 1 adds the `test` script and a runnable local suite only.
- **Any live, quota-spending test.** All provider calls are stubbed; the suite spends
  zero Spoonacular points.
- **Seeding `Math.random`.** We assert invariants that hold across all seeds, looped.

## Implementation Approach

Two-layer interception, each honoring the chosen boundary:

1. **Engine layer (`buildColdStartSet`)** — mock the `@/lib/spoonacular` module so
   `searchRecipes` / `getRecipeById` are spies. This proves the **call count** and the
   **args** the engine passes (number, cuisine, sort, offset-in-range) — the headline
   two-call invariant — without a network stub.
2. **Provider-edge layer (`searchRecipes`)** — stub global `fetch` and inspect the real
   request `URL`. This is the only seam that observes `addRecipeInformation=true` and
   the [0,900] clamp (serialized below the wrapper). Here `searchRecipes` is the *unit
   under test*, so reading its `fetch` output is not the "mock an internal collaborator"
   anti-pattern.
3. **Endpoint layer (auth gate)** — invoke the exported `POST` handler with a minimal
   fake `APIContext` lacking `locals.user`; assert 401 and zero `fetch` calls.

## Critical Implementation Details

- **`astro:env/server` resolution + fallback.** `getViteConfig` should resolve the
  virtual module; a `setupFiles` entry sets `process.env.SPOONACULAR_API_KEY` so
  `callApi` reaches `fetch`. If resolution fails under the Cloudflare adapter, fall back
  to `vi.mock("astro:env/server", () => ({ SPOONACULAR_API_KEY: "test-key" }))` in the
  affected test file. The smoke test in Phase 1 exists to surface this early.
- **Spy ESM named exports via `vi.mock`, not `vi.spyOn`.** `proposals.ts` imports
  `searchRecipes` as a live binding; the reliable interception is
  `vi.mock("@/lib/spoonacular", async (orig) => ({ ...(await orig()), searchRecipes: vi.fn(), getRecipeById: vi.fn() }))`,
  then set return values per test. `vi.spyOn` on the namespace can miss the binding
  depending on inlining.
- **Oracle constants are literals from the PRD.** Hard-code `2`, `20`, `0.035`, `3.40`,
  `[0,20]`, `[0,900]` in the tests. Importing `PER_CALL` / `MAX_OFFSET` to build the
  expected value makes it a mirror test that passes against a regression.
- **Defeat randomness by looping, not seeding.** Run each `buildColdStartSet` assertion
  block ~30 iterations; the invariants (2 calls, distinct cuisines, offset ∈ [0,20])
  must hold every iteration.
- **`not_configured` test is env-sensitive.** Forcing the empty-key branch may need
  `vi.stubEnv("SPOONACULAR_API_KEY", "")` plus `vi.resetModules()` + dynamic re-import so
  the binding re-reads. If brittle, assert the zero-fetch guard via the auth-gate test
  (which already proves "no key path → no call") and keep the edge test to params/clamp.

---

## Phase 1: Test Runner Bootstrap

### Overview

Install Vitest and stand up a `getViteConfig`-based config that resolves
`astro:env/server` and the `@/` alias, with a smoke test proving the harness end to
end. Nothing risk-specific yet — this is the foundation phases 2–4 build on.

### Changes Required

#### 1. Vitest dependency + scripts

**File**: `package.json`

**Intent**: Add `vitest` as a devDependency and the `test` / `test:watch` scripts so the
suite is runnable locally and (later, rollout Phase 4) in CI.

**Contract**: `"test": "vitest run"`, `"test:watch": "vitest"` under `scripts`; `vitest`
under `devDependencies`. No coverage tooling this phase.

#### 2. Vitest config

**File**: `vitest.config.ts` (new)

**Intent**: Wire Vitest into Astro's Vite pipeline so tests resolve `astro:env/server`
and `@/`, running in the node environment Astro 6 requires.

**Contract**: Uses `getViteConfig` from `astro/config`; `test.environment: "node"`;
`test.include` scoped to `src/**/__tests__/**/*.test.ts`; `test.setupFiles` points at the
setup file below. Tests import Vitest APIs explicitly (`import { describe, it, expect, vi } from "vitest"`) — no `globals`, so the strict eslint config needs no `types` change.

```ts
/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";

export default getViteConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

#### 3. Test setup file

**File**: `vitest.setup.ts` (new)

**Intent**: Provide a non-secret `SPOONACULAR_API_KEY` value to the test runtime so
`callApi` passes its `if (!SPOONACULAR_API_KEY)` guard and reaches `fetch` in the
edge-layer tests.

**Contract**: Sets `process.env.SPOONACULAR_API_KEY` to a dummy value if unset (`??=`).
Not a real secret.

#### 4. Harness smoke test

**File**: `src/lib/__tests__/harness.test.ts` (new)

**Intent**: Prove the runner, the `@/` alias, and `astro:env/server` resolution all work
by importing through the real module graph and asserting a pure invariant.

**Contract**: Imports `pickCuisinePair` and `CUISINES` from `@/lib/proposals` (which
transitively imports `astro:env/server` via `@/lib/spoonacular`); asserts `pickCuisinePair()`
returns two **distinct** values, both members of `CUISINES`. If this import fails, the
`astro:env` fallback in Critical Implementation Details applies.

### Success Criteria

#### Automated Verification

- [ ] `npm test` runs and the smoke test passes: `npm test`
- [ ] Lint (incl. strict type-check) passes on new files: `npm run lint`
- [ ] Astro types are in sync and the build is unaffected: `npm run astro sync && npm run build`

#### Manual Verification

- [ ] `npm run test:watch` starts and re-runs on file change
- [ ] The smoke test genuinely exercises `astro:env` resolution (confirm by temporarily removing the setup file and observing behavior, then restoring)

**Implementation Note**: After automated verification passes, pause for the human to
confirm the runner works locally before proceeding to Phase 2.

---

## Phase 2: `buildColdStartSet` Two-Call Invariant

### Overview

The headline risk-#1 test: prove a cold-start set issues exactly two provider calls with
the right per-call args, and no compensating third call on degrade. Wrapper-spy layer.

### Changes Required

#### 1. Proposal-engine call-count & args test

**File**: `src/lib/__tests__/proposals.test.ts` (new)

**Intent**: Assert the two-call invariant and per-call args that `buildColdStartSet`
passes to the provider wrapper, plus the formula-based cost reconciliation — all against
oracle constants from the PRD, not from `PER_CALL`.

**Contract**: Mocks `@/lib/spoonacular` exposing `searchRecipes` and `getRecipeById` as
`vi.fn()`; default `searchRecipes` resolves `{ ok: true, recipes: <4 valid candidates>, quota }`.
Across ~30 iterations asserts: `searchRecipes` called exactly **2** times; `getRecipeById`
**never** called; each call's arg object has `number === 20`, `sort === "random"`,
`offset` in `[0, 20]`, and `cuisine` ∈ `CUISINES`; the two cuisines are **distinct**. A
predicted-cost helper reconciles to **3.40** from the observed `number`, using the PRD
formula (not a stored constant):

```ts
const predicted = calls.reduce((s, [p]) => s + 1 + 0.035 * p.number, 0);
expect(predicted).toBeCloseTo(3.4, 2); // 2 × (1 + 0.035×20); "3.40" is the oracle, not PER_CALL
```

#### 2. Degrade-path no-leak test

**File**: `src/lib/__tests__/proposals.test.ts` (same file)

**Intent**: Prove a single failed provider call does not trigger a retry or a compensating
third call — a failure must degrade, not leak quota.

**Contract**: One mocked `searchRecipes` call resolves `{ ok: false, reason: "http_error", status: 502 }`,
the other `{ ok: true, ... }`; asserts `buildColdStartSet` returns `{ ok: true, degraded: … }`,
`searchRecipes` still called exactly **2** times, `getRecipeById` not called.

### Success Criteria

#### Automated Verification

- [ ] Two-call/args/cost tests pass: `npm test`
- [ ] Degrade-path no-leak test passes: `npm test`
- [ ] Lint passes: `npm run lint`

#### Manual Verification

- [ ] Temporarily set `PER_CALL = 40` in `src/lib/proposals.ts` and confirm the number/cost tests go **red**; restore
- [ ] Temporarily add a third `searchRecipes` call in `buildColdStartSet` and confirm the count test goes **red**; restore

**Implementation Note**: After automated verification passes, pause for the human to
confirm the mutation checks above genuinely fail before proceeding to Phase 3.

---

## Phase 3: Provider-Edge & Auth-Gate Leak Guards

### Overview

Cover the risk-#1 oracle items that live below or around the wrapper: the serialized
request params and offset clamp inside `searchRecipes`, and the auth gate's zero-quota
guarantee.

### Changes Required

#### 1. `searchRecipes` request-param & clamp test

**File**: `src/lib/__tests__/spoonacular.test.ts` (new)

**Intent**: Prove the real request URL carries `addRecipeInformation=true` and the passed
params, and that `offset` is clamped to the provider's [0,900] range — the items a wrapper
spy cannot see.

**Contract**: Stubs global `fetch` with `vi.stubGlobal("fetch", vi.fn())` returning a real
`new Response(JSON.stringify({ results: [...] }), { status: 200, headers: <X-API-Quota-*> })`.
Calls `searchRecipes({ cuisine: "italian", number: 20, sort: "random", offset })` and reads
the `URL` from `fetch.mock.calls[0][0]`. Asserts `pathname === "/recipes/complexSearch"`;
`searchParams`: `addRecipeInformation === "true"`, `number === "20"`, `cuisine === "italian"`,
`sort === "random"`, `apiKey` present. Clamp cases: `offset: -5` → `"0"`; `offset: 5000` →
`"900"`; `offset: 5` → `"5"`.

#### 2. `not_configured` zero-fetch guard

**File**: `src/lib/__tests__/spoonacular.test.ts` (same file)

**Intent**: Prove that with no API key, `searchRecipes` returns `not_configured` and fires
**zero** fetch calls (no key → no wasted base point).

**Contract**: Forces the empty-key branch (`vi.stubEnv` + `vi.resetModules()` / dynamic
re-import per Critical Implementation Details); asserts result `{ ok: false, reason: "not_configured", status: 0 }`
and the `fetch` spy has **0** calls. If brittle, drop per the fallback note (the auth-gate
test also proves a no-provider-call path).

#### 3. Auth-gate zero-quota test

**File**: `src/pages/api/__tests__/proposals.test.ts` (new)

**Intent**: Prove an unauthenticated `POST /api/proposals` returns 401 and spends zero
quota — the endpoint-level leak face of risk #1.

**Contract**: Stubs global `fetch`; imports the `POST` handler; calls it with a minimal
`APIContext` where `locals` has no `user`
(`{ locals: {}, request: new Request("http://test/api/proposals", { method: "POST" }), cookies: {} } as unknown as APIContext`).
Asserts `res.status === 401`, `await res.json()` equals `{ ok: false, reason: "unauthenticated" }`,
and the `fetch` spy has **0** calls.

### Success Criteria

#### Automated Verification

- [ ] `searchRecipes` param + clamp tests pass: `npm test`
- [ ] `not_configured` zero-fetch guard passes (or is consciously dropped per fallback): `npm test`
- [ ] Auth-gate 401 + zero-fetch test passes: `npm test`
- [ ] Lint passes: `npm run lint`

#### Manual Verification

- [ ] Temporarily remove `addRecipeInformation: "true"` from `searchRecipes` and confirm the param test goes **red**; restore
- [ ] Temporarily weaken the offset clamp (drop the `Math.min(..., 900)`) and confirm the clamp test goes **red**; restore
- [ ] Temporarily remove the `if (!user)` guard in the endpoint and confirm the auth-gate test goes **red**; restore

**Implementation Note**: After automated verification passes, pause for the human to
confirm the three mutation checks fail before proceeding to Phase 4.

---

## Phase 4: Cookbook + Status Sync

### Overview

Document the reusable unit-test pattern in the test-plan cookbook and sync rollout status
so future contributors (and the #4/#5 sub-phases) inherit the harness conventions.

### Changes Required

#### 1. Cookbook §6.1

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the §6.1 "TBD" with the concrete unit-test recipe this phase
established.

**Contract**: §6.1 "Adding a unit test" documents: `getViteConfig` + node env + explicit
`vitest` imports; `src/**/__tests__/*.test.ts` location; **spy the wrapper** (`vi.mock`
the module) for call-count/args, **stub global `fetch`** for URL-param/clamp; assert oracle
constants from the PRD (never from `PER_CALL`/`MAX_OFFSET`); loop to defeat randomness.
Points at the three test files as worked examples. Keep to ~8–12 lines.

#### 2. Rollout status

**File**: `context/foundation/test-plan.md`

**Intent**: Reflect that risk #1 landed while #4/#5 remain, without falsely marking the
phase complete.

**Contract**: §3 Phase 1 Status → `implementing` with a parenthetical "(risk #1 landed;
#4/#5 pending own research)"; §5 unit gate note may reference the now-runnable suite. Do
not set `complete` (that implies all three risks).

#### 3. Change identity

**File**: `context/changes/testing-harness-proposal-units/change.md`

**Intent**: Record that risk #1 is implemented and #4/#5 are the remaining follow-on for
this rollout phase.

**Contract**: `updated:` bumped; a Notes line stating risk #1 shipped, #4/#5 open with their
own `/10x-research`. (This plan's `## Progress` is the per-step execution ledger.)

### Success Criteria

#### Automated Verification

- [ ] §6.1 no longer contains "TBD": `grep -c "TBD" context/foundation/test-plan.md` reflects one fewer TBD
- [ ] Full suite still green after doc edits: `npm test`

#### Manual Verification

- [ ] A reader can add a new unit test from §6.1 alone, using the three files as examples
- [ ] §3 Phase 1 status honestly reflects "risk #1 only" (not `complete`)

**Implementation Note**: Final phase — after this, the risk-#1 slice of rollout Phase 1 is
done; #4 and #5 are the next changes.

---

## Testing Strategy

### Unit Tests

- **Two-call invariant** (`proposals.test.ts`): exactly 2 `searchRecipes`, 0 `getRecipeById`;
  per-call args (`number=20`, `sort=random`, `offset∈[0,20]`, distinct `cuisine∈CUISINES`);
  formula cost reconciles to 3.40; degrade fires no third call.
- **Provider-edge** (`spoonacular.test.ts`): URL carries `addRecipeInformation=true` + passed
  params; offset clamps to [0,900]; `not_configured` fires zero fetches.
- **Auth gate** (`api/__tests__/proposals.test.ts`): anonymous POST → 401 + zero fetches.
- **Edge cases per risk**: failed provider call (degrade, no leak), out-of-range offset
  (clamp), missing key (`not_configured`), missing user (401).

### Integration Tests

None this phase — MSW/endpoint-envelope/persistence integration is test-rollout Phase 2.

### Manual Testing Steps

1. `npm test` → all green.
2. Mutation checks (each restored after): `PER_CALL=40` reddens cost/count; a third
   `searchRecipes` reddens count; dropping `addRecipeInformation` reddens params; weakening
   the clamp reddens clamp; removing `if (!user)` reddens auth gate.
3. `npm run test:watch` re-runs on save.

## Performance Considerations

None. All provider calls are stubbed; the suite is CPU-only, spends zero Spoonacular quota,
and adds no runtime dependencies to the app bundle (Vitest is a devDependency).

## Migration Notes

First test infrastructure in the repo — additive only. No existing behavior changes; no data
migration. CI wiring of the unit gate is deferred to rollout Phase 4 per the lesson boundary.

## References

- Research (risk #1 oracle): `context/changes/testing-harness-proposal-units/research.md`
- Change identity: `context/changes/testing-harness-proposal-units/change.md`
- Test strategy: `context/foundation/test-plan.md` (§2 risk #1, §3 Phase 1, §4 stack, §6.1)
- Provider call path: [src/lib/spoonacular.ts:93,121-133](src/lib/spoonacular.ts:93)
- Two-call invariant: [src/lib/proposals.ts:202-226](src/lib/proposals.ts:202)
- Auth gate: [src/pages/api/proposals.ts:56-69](src/pages/api/proposals.ts:56)
- Harness setup: [astro.config.mjs:17-23](astro.config.mjs:17), [tsconfig.json:10](tsconfig.json:10), [eslint.config.js:14-38](eslint.config.js:14)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Test Runner Bootstrap

#### Automated

- [x] 1.1 `npm test` runs and the smoke test passes
- [x] 1.2 Lint (incl. strict type-check) passes on new files
- [x] 1.3 Astro types in sync and build unaffected (`astro sync && build`)

#### Manual

- [x] 1.4 `npm run test:watch` starts and re-runs on change
- [x] 1.5 Smoke test genuinely exercises `astro:env` resolution

### Phase 2: `buildColdStartSet` Two-Call Invariant

#### Automated

- [x] 2.1 Two-call/args/cost tests pass
- [x] 2.2 Degrade-path no-leak test passes
- [x] 2.3 Lint passes

#### Manual

- [ ] 2.4 `PER_CALL = 40` reddens the number/cost tests (then restored)
- [ ] 2.5 A third `searchRecipes` call reddens the count test (then restored)

### Phase 3: Provider-Edge & Auth-Gate Leak Guards

#### Automated

- [x] 3.1 `searchRecipes` param + clamp tests pass
- [x] 3.2 `not_configured` zero-fetch guard passes (or consciously dropped per fallback)
- [x] 3.3 Auth-gate 401 + zero-fetch test passes
- [x] 3.4 Lint passes

#### Manual

- [ ] 3.5 Removing `addRecipeInformation` reddens the param test (then restored)
- [ ] 3.6 Weakening the offset clamp reddens the clamp test (then restored)
- [ ] 3.7 Removing the `if (!user)` guard reddens the auth-gate test (then restored)

### Phase 4: Cookbook + Status Sync

#### Automated

- [ ] 4.1 §6.1 no longer contains "TBD"
- [ ] 4.2 Full suite still green after doc edits

#### Manual

- [ ] 4.3 A reader can add a new unit test from §6.1 alone
- [ ] 4.4 §3 Phase 1 status honestly reflects "risk #1 only"
