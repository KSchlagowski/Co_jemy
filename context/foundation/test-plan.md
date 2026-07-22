# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-07-22 (§3 Phase 1 → implementing; risk #1 unit suite landed; §6.1 cookbook filled)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the ground
   truth.

Hot-spot scope used for likelihood weighting: `src/` (single-package Astro
app — `src/lib/`, `src/pages/api/`, `src/components/proposals/`,
`src/pages/auth/`).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|-------------------------|--------|------------|--------------------------------|
| 1 | A proposal set (or a leaked extra provider call) consumes more than the ~3.4-pt budget; once the free plan's 50 pts/day is spent, every user gets HTTP 402 and the app stops proposing until the quota resets. | High | High | interview Q1 (top worry); PRD §Business Logic + §Open Q1; `spoonacular-retrieval-spike` archive; cold-start verification 5.6 ("no extra call leaked"); hot-spot `src/lib/` (5 commits/30d) |
| 2 | A user's rating history is lost across sessions, or one user's ratings surface in another user's profile. | High | Medium | PRD §Success Criteria (Guardrail) + FR-004; roadmap S-03; hot-spot `src/pages/api/` (6 commits/30d) |
| 3 | A recipe the user rated 👎 reappears in a later proposal — permanent exclusion (FR-009) breaks. | High | Medium | PRD FR-009 + US-01 acceptance ("never appears"); roadmap S-05 |
| 4 | The app persists a recipe field beyond id/title/image — or the response's `cuisines[]`/`dishTypes[]` — breaching Spoonacular's storage terms (which on a dispute can force deletion of stored recipe data). | High | Medium | PRD FR-011 + roadmap S-02 storage decision (2026-07-18); Supabase migration exists |
| 5 | Cold-start proposals return fewer than 2 cuisines because diversity is read from the response's often-empty `cuisines[]` instead of the pinned request-side cuisine. | Medium | Medium | PRD §Business Logic (request-side diversity) + US-02 acceptance; hot-spot `src/lib/`; interview Q3 |
| 6 | A proposal card leaks or breaks: unstripped provider HTML/macros in the description (Non-Goal breach + injected third-party anchors), or a dead publisher link / broken image with no fallback signal (silent dead click). | Medium | Medium | PRD §NFR (dead-link, markup-strip) + §Non-Goals (no macros); interview Q3; hot-spot `src/components/proposals/` (4 commits/30d) |
| 7 | One account writes a spoofed `recipes` row (anon-key `insert ... with check (true)`, first-write-wins) that is then served to other users. | Medium | Low | lessons.md ("shared catalogue tables under anon-key RLS"); roadmap S-03 (abuse / authorization lens) |

**Abuse / security coverage.** The product has auth, a metered external
API, and user-triggered writes. Risk #1 is the resource-abuse row (one
authenticated user draining a shared, costly budget for all). Risk #7 is
the authorization/integrity row (a write that is served to other users
without an ownership or payload check). Risk #2's isolation half is the
IDOR row (ratings must be readable/writable only by their owner).

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | A proposal set issues exactly one provider call per pinned cuisine (N cuisines → N calls), over-fetches within a call (`number` fixed), and never adds a per-slot or per-recipe call; total predicted points match the observed spend. | "The final result looked right, so the call count was fine" — result count is nearly free; it is the *call* count that spends the budget. | The request→provider-call mapping, where `number`/`offset` are set, and the offset cap (0–900 provider limit). Oracle is the PRD cost formula (1 pt + 0.035/recipe), not the code's own count. | unit | Asserting response contents instead of the number of provider calls; copying the call count from the implementation as the expected value. |
| #2 | A rating written in one session is readable in a fresh session for the same user, and is never readable or writable by a different user. | "Logged-in implies authorized" — authentication is not ownership; the row must belong to *this* user. | The ratings table schema, its RLS policies, the session/user identity on the write path, and how the row keys to the user. | integration | Testing persistence with a single user only (misses cross-user leakage); mocking Supabase so RLS is never exercised. |
| #3 | A recipe with a 👎 rating for the user is absent from every subsequent proposal set, and stays absent across the join even as new proposals are generated. | "Exclusion works because the title didn't match" — exclusion must key on the stable integer `spoonacular_id`, not fuzzy title/text. | The exclusion query, the id join between ratings and proposals, and what identity the exclusion keys on. | integration | Asserting exclusion via title/text match; testing with an empty rating set (never proves the exclusion path runs). |
| #4 | The only recipe fields written to the database are id, title, and image URL, plus the app's own request facets (requested cuisine/type, proposed-at timestamp); no provider-returned `cuisines[]`, `dishTypes[]`, `summary`, or description is persisted in any form. | "Requested cuisine is a provider recipe field" — it is the app's *own request* data, legal to store; the response's `cuisines[]` is the forbidden one. | The persist/upsert path and the exact column set the migration writes vs. what the provider payload contains. | unit / integration | Snapshotting the whole provider object into a fixture and asserting it "round-trips" (would green-light persisting forbidden fields). |
| #5 | A cold-start set spans at least 2 distinct cuisines, counted from the cuisines the app *requested and recorded*, not from the response's `cuisines[]` array. | "The response says 2 cuisines, so we're fine" — `cuisines[]` is derived and frequently empty; reading diversity from it silently under-delivers. | Where the requested cuisines are chosen and recorded, and how the "≥2 cuisines" guarantee is computed. | unit | Deriving the diversity assertion from the response body instead of the request; using a fixture where `cuisines[]` happens to be populated. |
| #6 | The rendered description contains no `<b>`/`<a>` markup and no calorie/macro figures; a card with a dead publisher link surfaces the fallback (`spoonacularSourceUrl`) or a signal rather than a silent dead click; a broken image shows a fallback, not a broken thumbnail. | "Truncating the summary is enough" — truncation alone can still leave markup, an inline macro figure, or a third-party anchor in the excerpt. | The description sanitize/truncate step, the link-fallback logic, and the image error/fallback handling. | component | Snapshot-only assertions that pass on any string; testing the happy path (live link, clean HTML) only. |
| #7 | A recipe row inserted by user A cannot be silently overwritten or spoofed such that user B is served attacker-chosen content; the write path validates the row or is not user-writable once other users read it. | "`with check (true)` is fine because it's just a catalogue" — it becomes a shared-trust surface the moment another user reads the row. | The `recipes` table RLS (insert/update policies), which client (anon vs service-role) writes it, and when it first becomes user-visible (S-03). | integration | Testing insert as a single user (never exercises the cross-user serve); asserting the happy upsert only. |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|------------|-----------------|---------------|------------|--------|---------------|
| 1 | Harness + proposal-engine units | Bootstrap the runner; defend the quota budget, storage-field discipline, and request-side diversity at the cheapest layer | #1, #4, #5 | unit | implementing (risk #1 landed; #4/#5 pending own research) | context/changes/testing-harness-proposal-units/ |
| 2 | Proposal API + card-render integration | Prove the endpoint envelope leaks no extra provider call and the card sanitizes/falls back correctly | #1, #6 | integration + component | not started | — |
| 3 | Rating-loop persistence & isolation | Lock the persistence guardrail, 👎-exclusion, per-user isolation, and the shared-catalogue write guard (lands with S-03/S-05) | #2, #3, #7 | integration | not started | — |
| 4 | E2e critical flow + gates wiring | One end-to-end run of login → propose → rate → re-propose (👎'd recipe absent) and enforce the test gates in CI | #2, #3 | e2e + gates | not started | — |

**Status vocabulary** (fixed — parser literals): `not started` →
`change opened` → `researched` → `planned` → `implementing` → `complete`.

Sequencing note: Phases 1–2 attack the already-shipped S-02 (cold-start
proposals) surface and are actionable now. Phase 3 depends on the ratings
schema landing (roadmap S-03) and slot logic (S-05); open it once those
slices exist. Phase 4 closes the loop end-to-end and wires the floor into
`.github/workflows/ci.yml`.

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.
Recommendations here are grounded in local manifests/configs plus the
MCP/tools actually exposed in the current session.

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| unit + integration | Vitest | none yet — see §3 Phase 1 | Astro/Vite-native via `getViteConfig` (`astro/config`); React components via `@testing-library/react` + `jsdom`. Verify exact config in Phase 1 research/plan. |
| API mocking | MSW | none yet — see §3 Phase 2 | Mock the Spoonacular HTTP edge only (`GET /recipes/complexSearch`). Never mock internal modules; the point of #1/#6 is exercising the real request path. |
| e2e | Playwright | none yet — see §3 Phase 4 | One critical flow against a local build. Runs on the Cloudflare adapter output; no Node-only test shims in server code. |
| accessibility | axe-core | optional | Mobile-responsive is an NFR; if added, fold into the Phase 4 Playwright run for the dashboard/proposal screen only. |
| (optional) AI-native | multimodal visual review | checked: 2026-07-22 | Selective — the **mobile proposal card only** (image fallback, truncation, ≥2-cuisine layout). NOT for static/marketing pages, and NOT where a deterministic component test already catches the regression. |

**Stack grounding tools (current session):**
- Docs: Context7 — available this session; not queried (Vitest/Playwright setup for Astro/Vite is standard, and runner configuration is deferred to Phase 1 per the lesson boundary); use it when wiring the runner; checked: 2026-07-22
- Search: Exa.ai — available this session; not used (no discovery gap for this stack); checked: 2026-07-22
- Runtime/browser: Playwright MCP — not available in current session; Playwright itself is the planned e2e tool (§3 Phase 4); checked: 2026-07-22
- Provider/platform: GitHub (`gh` CLI, Actions), Cloudflare (`wrangler`), Supabase (CLI in devDeps) — available; relevant to gates (CI-green, live smoke, local DB for RLS tests); checked: 2026-07-22

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase <N>" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate | Where | Required? | Catches |
|------|-------|-----------|---------|
| lint + typecheck (`astro sync` + eslint + build) | local + CI (`ci.yml`) | required (already wired) | syntactic / type drift; react-compiler violations |
| unit | local + CI | required after §3 Phase 1 | quota/call-count, storage-field, diversity logic regressions (risk #1 suite runnable now via `npm test`; #4/#5 pending) |
| integration (API + component + RLS) | local + CI | required after §3 Phase 2 | endpoint envelope, card sanitize/fallback, persistence, isolation |
| e2e on critical flow | CI on PR | required after §3 Phase 4 | broken login → propose → rate → re-propose path |
| post-edit hook | local (agent loop) | recommended (Module 3 Lesson 3) | regressions at edit time — configured in a later lesson, not here |
| multimodal visual review | CI on PR | optional | mobile proposal-card rendering issues a classic component test misses |
| pre-prod smoke | between merge + prod | optional | environment-specific failures (live Worker + live Supabase + real quota) — the `verification.md` convention already in use |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase <N>."

### 6.1 Adding a unit test

Runner: Vitest in the **`node`** environment (Astro 6). `vitest.config.ts`
hand-wires the two resolves tests need — the `@/` alias and an
`astro:env/server` stub (`test/stubs/astro-env-server.ts`) — because the
Cloudflare adapter's Vite plugin rejects `getViteConfig()`'s SSR externals;
`vitest.setup.ts` seeds a dummy `SPOONACULAR_API_KEY`. Put tests at
`src/**/__tests__/*.test.ts`; import Vitest APIs explicitly (no globals).

Intercept at the cheapest boundary that gives signal:

- **Spy the wrapper** for call-count/args — `vi.mock("@/lib/spoonacular", …)`
  replacing the named exports with `vi.fn()` (live ESM bindings; a namespace
  `vi.spyOn` can miss them). Worked example: `src/lib/__tests__/proposals.test.ts`.
- **Stub global `fetch`** (`vi.stubGlobal`) when the assertion needs the real
  request URL — params serialized *inside* the unit, the offset clamp. Worked
  example: `src/lib/__tests__/spoonacular.test.ts`.
- **Endpoint leak faces** — invoke the exported handler with a fake `APIContext`.
  Worked example: `src/pages/api/__tests__/proposals.test.ts`.

Assert **oracle constants from the PRD** (2 calls, `number=20`, `1 + 0.035n`
→ 3.40, `[0,900]`), never imported from `PER_CALL`/`MAX_OFFSET` — importing the
code's own constant makes it a mirror test that passes against a regression.
**Loop** (~30×) to defeat `Math.random`, never seed.

### 6.2 Adding an integration test

TBD — see §3 Phase 2 (Astro API route + `@testing-library/react` component
tests; mock the Spoonacular HTTP edge with MSW, nothing internal).

### 6.3 Adding an e2e test

TBD — see §3 Phase 4 (Playwright over the login → propose → rate →
re-propose critical flow).

### 6.4 Adding a test for a new API endpoint

TBD — see §3 Phase 2 (assert request → response envelope AND side-effects,
including provider-call count; mock only the external HTTP edge).

### 6.5 Adding a test for a new persistence / RLS rule

TBD — see §3 Phase 3 (per-user isolation and shared-catalogue write-guard
patterns against a local Supabase).

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note
here capturing anything surprising the rollout phase taught.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout. Future contributors should respect
these unless the underlying assumption changes.

- **Auth UI components** (sign-in / sign-up forms and their fields) — Supabase
  owns the hard parts; low blast radius for a solo MVP. Re-evaluate if custom
  auth logic (beyond Supabase calls) is added. (Source: Phase 2 interview Q5.)
- **Static / marketing pages** (`index.astro`, `Layout`, `Banner`, `Welcome`) —
  cosmetic, rarely change; snapshot tests here break often and catch little.
  Re-evaluate if any gains real interactivity. (Source: Phase 2 interview Q5.)
- **Exact Spoonacular response JSON shapes** — the provider owns the contract;
  asserting its structure mirrors their API rather than our logic. We test how
  we *use* the response (call count, field discipline, sanitize), not its shape.
  Re-evaluate if we depend on a new provider field. (Source: cost × signal.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-07-22
- Stack versions last verified: 2026-07-22
- AI-native tool references last verified: 2026-07-22

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
