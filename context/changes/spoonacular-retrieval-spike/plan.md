# Spoonacular Retrieval & Quota Spike — Implementation Plan

## Overview

Verify that a `fetch`-based Spoonacular `complexSearch` call works from the deployed Cloudflare Worker, measure the real point cost of assembling proposal sets against the free plan's 50-points/day quota, sample `sourceUrl` liveness, and land the results as binding constraints for S-02 (`cold-start-proposals`). The surviving artifact is a minimal `src/lib/spoonacular.ts` client; the spike endpoint is deleted when findings are recorded.

This is roadmap item **F-01** (`context/foundation/roadmap.md`), a foundation spike — the deliverable is *measurement and a findings document*, not product code.

## Current State Analysis

- **No Spoonacular code exists.** `SPOONACULAR_API_KEY` is declared in `.env.example:7` but consumed nowhere; `astro.config.mjs` does not declare it in the env schema.
- **Env secret pattern is settled**: secrets are declared via `envField.string({ context: "server", access: "secret", optional: true })` in `astro.config.mjs:17-22` and imported from `astro:env/server` (`src/lib/supabase.ts:3`, `src/lib/config-status.ts:1`). Note: `context/foundation/infrastructure.md:63,99` recommends `cloudflare:workers` env access — the codebase contradicts it and works; follow the code.
- **API route pattern**: named `APIRoute` verb exports (`src/pages/api/auth/signin.ts:4`). All three existing endpoints return redirects — this spike creates the repo's **first JSON endpoint**. `output: "server"` in `astro.config.mjs:11` means no prerender flag is needed.
- **Middleware leaves `/api/*` public**: `src/middleware.ts:4` protects only `/dashboard`. An unguarded spike endpoint on the live workers.dev URL would let anyone drain the daily quota (~50 requests kill it).
- **Deploy**: push to `master` → `.github/workflows/deploy.yml` runs lint + build, then `wrangler deploy`. Runtime secrets are set out-of-band via `wrangler secret put` (workflow comment at `deploy.yml:30-31`); the workflow will not inject `SPOONACULAR_API_KEY`.
- **Scratch convention**: `.gitignore:30-32` reserves `spoon.json` and `docs.html` at repo root as untracked spike dumps.
- **No test runner exists** — verification is lint/build plus manual calls.

Provider facts are pre-settled in `context/changes/spoonacular-retrieval-spike/change.md` §Known before starting (endpoint, cost model ~1 + 0.035n points/call, terms, `sort=random` + `offset` ≤900, `apiKey` query param). The spike implements them; it does not re-decide them.

## Desired End State

1. `src/lib/spoonacular.ts` exists, lint-clean, and demonstrably works from the **deployed** Worker (not just local dev).
2. `context/changes/spoonacular-retrieval-spike/findings.md` records, with measured numbers: the actual point cost of a 2-cuisine and a 4-cuisine proposal set, the confirmed sets-per-day arithmetic on the free plan, the re-fetch-by-id cost for steady-state slots 1–2, the `sourceUrl` dead-link rate over a ~50-recipe sample, and whether `spoonacularSourceUrl` works as a fallback.
3. `docs/reference/contract-surfaces.md` exists and states the schema/UI constraints S-02 must obey (storable fields, attribution contract, summary handling, quota budget per set).
4. The spike endpoint and `SPIKE_TOKEN` are removed; the working tree carries no leftover spike surface.

Verify by: reading findings.md and checking every number has a measured value; confirming `src/pages/api/spike/` no longer exists; `npm run lint` and `npm run build` pass.

### Key Discoveries:

- `astro:env/server` + `envField` is the working secret mechanism (`src/lib/supabase.ts:3`, `astro.config.mjs:17-22`)
- Spoonacular returns quota telemetry on every response via `X-API-Quota-Used`, `X-API-Quota-Request`, `X-API-Quota-Left` headers — this is the measurement instrument; no separate quota API needed
- Middleware redirect-to-signin is HTML-flow behavior; a JSON API must guard inside the handler and return 401 (`src/middleware.ts:18-20`)
- One `complexSearch` call can return up to 100 results (~4.5 points), so the 50-URL liveness sample costs one call, not fifty

## What We're NOT Doing

- No database schema or migration — that is S-02's job, informed by this spike's findings
- No proposal UI, no slot logic, no rating anything
- No locale/corpus-fit evaluation — **explicitly deferred by user decision (2026-07-18)**; real usage after S-02 will answer it. Record the deferral in findings.md so the unknown isn't silently lost.
- No caching of any provider field (terms require prior written permission; out of scope)
- No deliberate quota exhaustion / 402 triggering — the spike spends ≤25 points/day (user-set cap); 402 handling is coded but only observed if it happens naturally
- No committing of `spoon.json` / `docs.html` dumps (gitignored by name)
- Not retitling GitHub issue #1 (roadmap housekeeping, not this plan)

## Implementation Approach

Three phases: wire a minimal client and a token-guarded spike endpoint locally → deploy and run a fixed measurement protocol under the 25-point cap → write findings and constraints, then delete the spike surface. The lib is written as the piece S-02 will reuse (typed params, quota telemetry, 402 as a typed failure); the endpoint stays deliberately dumb — a thin authenticated passthrough for driving measurements with curl.

## Critical Implementation Details

- **Quota accounting**: read `X-API-Quota-Used` / `X-API-Quota-Left` from every response and return them alongside results. Measurements are deltas between consecutive calls' `quota-used` values — more trustworthy than the documented cost formula, and confirming the formula *is* the measurement.
- **Key hygiene**: `apiKey` travels as a query parameter, so never log full request URLs (Workers observability is enabled). The lib builds the URL internally and logs nothing.
- **Secrets-before-deploy ordering**: run `wrangler secret put SPOONACULAR_API_KEY` and `wrangler secret put SPIKE_TOKEN` **before** merging to master, or the deployed endpoint 500s/401s on arrival. Both env fields are declared `optional: true` (matching the Supabase pattern) so CI builds without them.
- **402 is a normal outcome, not a crash**: the free plan returns HTTP 402 when spent. The lib must surface it as a typed result (`quota_exhausted`) so the endpoint can report it as JSON instead of throwing.

## Phase 1: Wire the client locally

### Overview

Declare the secrets, build the minimal reusable client, expose it behind a token-guarded spike endpoint, and confirm one real call works from local dev.

### Changes Required:

#### 1. Env schema

**File**: `astro.config.mjs`

**Intent**: Declare `SPOONACULAR_API_KEY` and `SPIKE_TOKEN` so they're importable from `astro:env/server`, mirroring the existing Supabase entries.

**Contract**: Two new `envField.string({ context: "server", access: "secret", optional: true })` entries in `env.schema`.

#### 2. Env example

**File**: `.env.example`

**Intent**: Add `SPIKE_TOKEN` beside the existing `SPOONACULAR_API_KEY` entry, noting it guards the temporary spike endpoint.

**Contract**: One new documented variable line.

#### 3. Spoonacular client (the surviving artifact)

**File**: `src/lib/spoonacular.ts`

**Intent**: Minimal typed client for `GET /recipes/complexSearch` with `addRecipeInformation=true`, plus a by-id lookup used to measure steady-state re-fetch cost. Exposes quota telemetry from response headers and 402 as a typed outcome. This is the module S-02 will import.

**Contract**:

- `searchRecipes(params: { cuisine?: string; number?: number; offset?: number; sort?: "random" }): Promise<SpoonacularResult>` — always sends `addRecipeInformation=true`; never sends `includeNutrition`/`addRecipeNutrition`.
- `getRecipeById(id: number): Promise<SpoonacularResult>` — `GET /recipes/{id}/information`, for the slots-1/2 re-fetch cost measurement.
- `SpoonacularResult` is a discriminated union: `{ ok: true; recipes: RecipeCandidate[]; quota: QuotaInfo }` | `{ ok: false; reason: "quota_exhausted" | "http_error"; status: number; quota?: QuotaInfo }`.
- `RecipeCandidate` carries only what a proposal card needs: `id`, `title`, `image`, `summary`, `sourceName`, `sourceUrl`, `spoonacularSourceUrl`.
- `QuotaInfo` = `{ used: number; request: number; left: number }` parsed from the `X-API-Quota-*` headers.
- The `apiKey` query param is appended internally from `astro:env/server`; no URL containing it is logged or returned.

#### 4. Spike endpoint (temporary)

**File**: `src/pages/api/spike/spoonacular.ts`

**Intent**: Thin JSON passthrough for driving measurements with curl against local dev and the deployed Worker. Deleted in Phase 3.

**Contract**: `export const GET: APIRoute`. Rejects with 401 JSON unless header `x-spike-token` equals `SPIKE_TOKEN`. Forwards `cuisine`, `number`, `offset`, `sort`, and optional `id` (routes to `getRecipeById`) query params to the lib. Returns the full `SpoonacularResult` as JSON — including the `quota` block — with appropriate status (200 / 402 / 502). First JSON endpoint in the repo; plain `Response` with JSON body is fine.

### Success Criteria:

#### Automated Verification:

- Types in sync: `npm run astro sync` completes cleanly
- Linting passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- With real key in `.env`, `curl` against local dev returns recipes with non-null `sourceUrl`/`sourceName` and a populated `quota` block (spends ~1–2 points; counts against the day's 25-point cap)
- Request without `x-spike-token` returns 401

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Deploy and measure

### Overview

Set the Worker secrets, deploy through the existing CI pipeline, and run a fixed measurement protocol under the 25-point/day cap. This phase produces raw numbers; interpretation happens in Phase 3.

### Changes Required:

#### 1. Worker secrets (out-of-band, before merge)

**File**: none (ops)

**Intent**: `wrangler secret put SPOONACULAR_API_KEY` and `wrangler secret put SPIKE_TOKEN` against the `co-jemy` Worker, so the deployed endpoint works on arrival.

**Contract**: Secrets exist on the Worker before the deploy that ships the endpoint.

#### 2. Deploy

**File**: none (git)

**Intent**: Commit Phase 1 and push to `master`; `.github/workflows/deploy.yml` lint-gates, builds, and deploys.

**Contract**: The spike endpoint is reachable at `https://co-jemy.mediewilnp.workers.dev/api/spike/spoonacular`.

#### 3. Measurement protocol (~15 points total, within the 25-point cap)

**File**: raw responses land in `spoon.json` (gitignored) and notes in the change folder

**Intent**: Execute in order, recording the `quota.used` delta after each step:

- **M1 — deployed smoke** (~1 pt): `number=1`, no cuisine. Confirms the call works in production and headers parse.
- **M2 — 2-cuisine cold-start set** (~2.7 pts): two calls, distinct `cuisine` values, `number=10`, `sort=random`. The US-02 minimum set.
- **M3 — 4-cuisine cold-start set** (~5.4 pts): four calls, distinct cuisines, `number=10`. The full-diversity set.
- **M4 — over-fetch dump** (~4.5 pts): one call, `number=100`, saved as `spoon.json` — the liveness sample and the over-fetch-economics datapoint.
- **M5 — re-fetch by id** (~1 pt): one `getRecipeById` call. The steady-state slots-1/2 cost.

**Contract**: Each M-step's predicted vs. measured point cost is recorded; if measured diverges from the ~1 + 0.035n formula by more than ~20%, note it — that changes the sets-per-day arithmetic S-02 budgets against.

#### 4. Liveness check (local, zero quota)

**File**: throwaway script in the session scratchpad (not committed)

**Intent**: Read `spoon.json`, issue HEAD (falling back to GET) requests against ~50 `sourceUrl`s, record HTTP status per URL; for any dead one, check whether its `spoonacularSourceUrl` responds. Produces the dead-link rate and the fallback verdict.

**Contract**: Output is a small summary table (total, alive, dead, fallback-alive) pasted into findings.md in Phase 3. The script itself is disposable and never enters the repo.

### Success Criteria:

#### Automated Verification:

- CI deploy workflow run is green (`gh run list --workflow=deploy.yml`)

#### Manual Verification:

- Deployed smoke call (M1) returns recipes and quota headers from the production URL
- All five M-steps executed with quota deltas recorded, total spend ≤25 points
- Liveness summary table produced from the ~50-URL sample

**Implementation Note**: After completing this phase, pause for manual confirmation — the recorded numbers are the spike's entire value; confirm they're captured before cleanup begins.

---

## Phase 3: Record findings, seed constraints, clean up

### Overview

Turn raw numbers into verdicts and binding constraints, then remove the temporary spike surface.

### Changes Required:

#### 1. Findings document

**File**: `context/changes/spoonacular-retrieval-spike/findings.md`

**Intent**: The spike's deliverable. Answers unknowns 1 and 3 from change.md with measured data and records unknown 2 as deferred.

**Contract**: Must contain: measured cost table (M1–M5, predicted vs. actual); sets-per-day arithmetic for 2- and 4-cuisine sets on 50 points/day; steady-state set cost including slots-1/2 re-fetches; a **quota verdict** (does the free plan survive development + real use, or is the $29/mo tier / request-shaping needed before S-02?); dead-link rate and `spoonacularSourceUrl` fallback verdict, with the NFR recommendation (active reachability check vs. graceful error state); an explicit "Unknown 2 (locale fit): deferred by user decision 2026-07-18, to be answered by real usage after S-02" entry.

#### 2. Contract surfaces registry

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Seed the load-bearing-names registry (referenced by CLAUDE.md but not yet existing) with the constraints S-02's migration and UI must obey.

**Contract**: Records at minimum — storable fields (`spoonacular_id`, `title`, `image` URL, plus app-side request facets: requested `cuisine`, requested `type`, proposed-at timestamp — with the FR-011 rationale for why the facets are legal); prohibited-to-persist fields (`summary`, `cuisines[]`, `dishTypes[]`, anything derived); attribution contract (`sourceName` + link to `sourceUrl`; `spoonacularSourceUrl` only as dead-link fallback); summary display rule (strip HTML, truncate, no nutrition figures); the measured quota budget per proposal set; the `src/lib/spoonacular.ts` public surface (`searchRecipes`, `getRecipeById`, `SpoonacularResult`).

#### 3. Remove the spike surface

**File**: `src/pages/api/spike/spoonacular.ts` (delete), `astro.config.mjs`, `.env.example`

**Intent**: Delete the endpoint; remove `SPIKE_TOKEN` from the env schema and `.env.example` (and `wrangler secret delete SPIKE_TOKEN`). `src/lib/spoonacular.ts` and `SPOONACULAR_API_KEY` remain — they are S-02's starting point.

**Contract**: After this change, `grep -ri spike src/` returns nothing; lint and build still pass.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Production build passes: `npm run build`
- Spike endpoint gone: `src/pages/api/spike/` does not exist

#### Manual Verification:

- findings.md reviewed: every required number present and the quota verdict is an actual decision, not a restatement of the question
- contract-surfaces.md reviewed against PRD FR-010/FR-011

---

## Testing Strategy

### Unit Tests:

None — the repo has no test runner, and adding one for a spike is scope creep. The lib's correctness is demonstrated by live calls.

### Manual Testing Steps:

1. Local: curl the spike endpoint with and without `x-spike-token` (200 vs 401)
2. Deployed: repeat M1 against the production URL
3. Confirm quota deltas match the `X-API-Quota-Used` progression across M-steps

## Performance Considerations

None runtime-relevant — the spike makes single sequential calls. The *economic* performance (points per set) is the spike's subject and lands in findings.md.

## Migration Notes

No data or schema. The only stateful artifacts are Worker secrets: `SPOONACULAR_API_KEY` persists for S-02; `SPIKE_TOKEN` is deleted in Phase 3.

## References

- Change identity & banked research: `context/changes/spoonacular-retrieval-spike/change.md`
- Roadmap item F-01: `context/foundation/roadmap.md:65-81`
- PRD constraints: `context/foundation/prd.md` (FR-003, FR-010, FR-011, §Business Logic)
- Env/secret pattern: `astro.config.mjs:17-22`, `src/lib/supabase.ts:3`
- API route pattern: `src/pages/api/auth/signin.ts:4`
- Deploy pipeline: `.github/workflows/deploy.yml`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Wire the client locally

#### Automated

- [x] 1.1 Types in sync: `npm run astro sync` completes cleanly — deea7fd
- [x] 1.2 Linting passes: `npm run lint` — deea7fd
- [x] 1.3 Production build passes: `npm run build` — deea7fd

#### Manual

- [x] 1.4 Local curl with real key returns recipes + quota block (≤2 points spent) — deea7fd
- [x] 1.5 Request without `x-spike-token` returns 401 — deea7fd

### Phase 2: Deploy and measure

#### Automated

- [x] 2.1 CI deploy workflow run is green — d082078

#### Manual

- [x] 2.2 Deployed smoke call (M1) returns recipes and quota headers from production URL — d082078
- [x] 2.3 All five M-steps executed with quota deltas recorded, total spend ≤25 points — d082078
- [x] 2.4 Liveness summary table produced from ~50-URL sample — d082078

### Phase 3: Record findings, seed constraints, clean up

#### Automated

- [x] 3.1 Linting passes: `npm run lint`
- [x] 3.2 Production build passes: `npm run build`
- [x] 3.3 Spike endpoint gone: `src/pages/api/spike/` does not exist

#### Manual

- [x] 3.4 findings.md reviewed: all numbers present, quota verdict is a decision
- [x] 3.5 contract-surfaces.md reviewed against PRD FR-010/FR-011
