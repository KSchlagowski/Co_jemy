---
date: 2026-07-22T12:50:36+0200
researcher: KSchlagowski
git_commit: 6ed0384743d0849641911d9c8b3999899262f02a
branch: master
repository: Co_jemy
topic: "Risk #1 — quota / provider-call-count budget (test-plan Phase 1)"
tags: [research, codebase, spoonacular, quota, proposals, risk-1, unit-tests]
status: complete
last_updated: 2026-07-22
last_updated_by: KSchlagowski
---

# Research: Risk #1 — quota / provider-call-count budget

**Date**: 2026-07-22T12:50:36+0200
**Researcher**: KSchlagowski
**Git Commit**: 6ed0384743d0849641911d9c8b3999899262f02a
**Branch**: master
**Repository**: Co_jemy

## Research Question

From `context/foundation/test-plan.md`, **risk #1**:

> A proposal set (or a leaked extra provider call) consumes more than the ~3.4-pt
> budget; once the free plan's 50 pts/day is spent, every user gets HTTP 402 and
> the app stops proposing until the quota resets.

The §2 Risk Response Guidance says the oracle must be the **PRD cost formula
(1 pt + 0.035/recipe), not the code's own count**, and the research must ground
"the request→provider-call mapping, where `number`/`offset` are set, and the
offset cap (0–900 provider limit)." This document produces that oracle from
sources (PRD, the F-01 measurement spike, provider terms) — not from copying the
implementation's behaviour — so Phase 1 can write a **unit** test that fails if a
future change leaks an extra provider call.

## Summary

**The oracle, in one line:** a cold-start proposal set must issue **exactly two**
`GET /recipes/complexSearch` calls — one per pinned cuisine, `number=20` each,
`offset` in 0–20 — and **zero** other provider calls, for a predicted spend of
`2 × (1 + 0.035×20) = 3.40` points. Call count, not result count, is what spends
the budget.

Key grounded facts:

1. **The cost formula is measured-exact, not assumed.** Spoonacular charges
   `1 pt base per call + 0.01/result + 0.025/recipe for addRecipeInformation`, i.e.
   `1 + 0.035n` per call. The F-01 spike measured this live against the provider's
   own `X-API-Quota-*` headers and confirmed it exactly (`quota.request` matched
   the per-call delta every time).
2. **Base cost is per call, so call count dominates.** 100 recipes in one call
   cost 4.50 pts; 40 recipes across four calls cost 5.40 pts. Over-fetching inside
   a call is nearly free; adding a call costs a full ~1-pt base.
3. **The current live path is the two-call cold-start path only.** `buildColdStartSet`
   fires exactly two `searchRecipes` calls. `getRecipeById` (the future steady-state
   per-id re-fetch, +1 pt each) is **defined but has zero call sites** — no
   per-recipe call can leak today.
4. **The auth gate fires before any provider call**, so an anonymous request spends
   zero quota.
5. **Two offset caps for two reasons**: the provider's hard 0–900 clamp (cost
   safety — a bad value would burn a base point on a guaranteed error) and the
   app's measured `MAX_OFFSET=20` (diversity — past offset ~20 several cuisines
   return zero results, collapsing a two-cuisine set to one while still charging
   both base points).
6. **No automated test exists yet.** Risk #1 is covered only by a one-time manual
   attestation (verification 5.6, "no extra call leaked in ≈3.40 pts"). The Phase 1
   unit test converts that one-time check into a regression gate.

## Detailed Findings

### The provider-call surface — exactly one fetch, two live call sites

There is a single function that performs a real network call to Spoonacular, and
everything funnels through it:

- The only raw provider fetch: [`src/lib/spoonacular.ts:93`](src/lib/spoonacular.ts:93) — `response = await fetch(url)` inside `callApi`. `url` = `BASE_URL` (`https://api.spoonacular.com`, [`spoonacular.ts:3`](src/lib/spoonacular.ts:3)) + path + `apiKey` query param.
- `searchRecipes` → `callApi("/recipes/complexSearch", …)` — [`spoonacular.ts:121-133`](src/lib/spoonacular.ts:121).
- `getRecipeById` → `callApi("/recipes/${id}/information", …)` — [`spoonacular.ts:136-141`](src/lib/spoonacular.ts:136).

**Live call sites (the whole repo):**

| Wrapper | Call sites | Where |
|---|---|---|
| `searchRecipes` | **2** | [`src/lib/proposals.ts:207`](src/lib/proposals.ts:207) & [`:208`](src/lib/proposals.ts:208), both inside `buildColdStartSet` |
| `buildColdStartSet` | **1** | [`src/pages/api/proposals.ts:69`](src/pages/api/proposals.ts:69) (the `POST` route) |
| `getRecipeById` | **0** | defined-but-unused; never imported anywhere in `src/` |

The live trigger chain is: [`ProposalList.tsx:26`](src/components/proposals/ProposalList.tsx:26) (client `fetch("/api/proposals", { method: "POST" })`) → `POST /api/proposals` → `buildColdStartSet` → 2× `searchRecipes` → 2× provider `fetch`.

**Definitive: today, a proposal request can fire at most two provider calls.** The
spike/debug endpoint (`src/pages/api/spike/spoonacular.ts`, referenced in
`lessons.md`) **no longer exists on disk** — it was deleted after the spike, as
its plan required. So there is no second live call path.

### The cost formula oracle — measured against real quota headers

The formula the project treats as ground truth, decomposed
(`context/changes/spoonacular-retrieval-spike/change.md:40`):

> "Cost model: 1 point base **per call** + 0.01/result, plus 0.025/recipe for
> `addRecipeInformation` — so ~1 + 0.035n per call. Call count dominates;
> over-fetching within a call is nearly free."

So the PRD's "1 pt + 0.035/recipe" = `1 (base) + 0.01 (result) + 0.025 (addRecipeInformation)`.

The F-01 spike **measured** this live, reading the provider's running total from
`X-API-Quota-Used` deltas (`context/archive/2026-07-16-spoonacular-retrieval-spike/measurements.md`):

| Measurement | Params | Predicted | **Measured** |
|---|---|---|---|
| M1 smoke | `number=1` | 1.035 | **1.03** |
| M2a/M2b | `cuisine=…&number=10&sort=random` | 1.35 | **1.35 / 1.36** |
| M3a–d | four cuisines, `number=10` | 1.35 | **1.35 each** |
| M4 | `number=100` | 4.50 | **4.50** |
| M5 | `/recipes/{id}/information` re-fetch | 1.00 | **1.00** |

Verdict (`measurements.md:22`): "`quota.request` matched the per-call delta every
time. The documented cost formula is confirmed exactly." This is why the oracle is
the **formula**, and why the `X-API-Quota-*` headers are a trustworthy measurement
instrument — the code already parses them into `QuotaInfo` at
[`spoonacular.ts:39-49`](src/lib/spoonacular.ts:39).

**Important:** `number=20` was never measured directly (the spike used 10 and 100).
`1 + 0.035×20 = 1.70` per call is an interpolation on a formula proven exact — safe,
but the aggregate 3.40/set is the load-bearing figure, and it was only ever
*observed* live once (verification 5.6, below).

### The two-call invariant — the core of risk #1

`buildColdStartSet` is written so two calls is **both floor and ceiling**:

- [`src/lib/proposals.ts:20-21`](src/lib/proposals.ts:20) — `/** Two calls is both the floor and the ceiling — call count dominates quota cost. */` and `const PER_CALL = 20`.
- [`src/lib/proposals.ts:206-209`](src/lib/proposals.ts:206) — exactly two `searchRecipes({ cuisine, number: PER_CALL, sort: "random", offset: randomOffset() })` calls, run concurrently via `Promise.all`, one per cuisine from `pickCuisinePair()`.
- `SET_SIZE = 4` ([`proposals.ts:22`](src/lib/proposals.ts:22)): the over-fetch of 20/call exists to guarantee 4 survivors *after* validation drops and dedup — a deliberate cost trade (2×20 = 3.40 pts vs the spike's 2×10 = 2.71) recorded in `cold-start-proposals/plan.md:20,56`.

**The N-cuisines → N-calls rule** (risk #1's "prove protection" column): cold start
pins **two distinct** cuisines (`pickCuisinePair`, [`proposals.ts:156-160`](src/lib/proposals.ts:156)), so N=2 → 2 calls. Diversity is established on the **request** side (which cuisine the app asked for), never read back from the response — that is risk #5's concern, but it shares this call path.

### Where `number` / `offset` are set, and the two offset caps

- **`number` is fixed** at `PER_CALL = 20` ([`proposals.ts:21`](src/lib/proposals.ts:21)) — over-fetch within the call, never a second call. Passed through to the query at [`spoonacular.ts:124`](src/lib/spoonacular.ts:124).
- **`offset` varies** for variety — `randomOffset()` returns 0…`MAX_OFFSET` ([`proposals.ts:162-164`](src/lib/proposals.ts:162)).

Two caps, two distinct reasons:

1. **Provider hard cap 0–900** — enforced in `searchRecipes`:
   [`spoonacular.ts:125-126`](src/lib/spoonacular.ts:125) —
   `query.offset = String(Math.min(Math.max(params.offset, 0), 900))`. Comment:
   "clamp so a bad value can't burn a quota point on a guaranteed error." This is a
   **cost** guard (a past-900 offset would still charge the ~1-pt base and return
   nothing). Added as impl-review finding F6.
2. **App measured cap `MAX_OFFSET = 20`** — [`proposals.ts:24-28`](src/lib/proposals.ts:24):
   "Measured 2026-07-20 across all six cuisines: at offset 50 `chinese`, `greek`,
   and `thai` return zero results, which silently yields a single-cuisine set while
   still spending both quota points. All six return results at offset 20." This is a
   **diversity** guard, but its cost face is identical to risk #1: an over-cap offset
   is a *paid-for zero-result call*.

The two are independent, so a unit test can pin each separately: `randomOffset()`
stays in 0–20; `searchRecipes` clamps any out-of-range offset to 0–900 (the backstop
that protects a *future* caller — e.g. steady-state — passing a raw offset).

> Doc drift to avoid inheriting: `cold-start-proposals/plan.md:197` says offset
> "0–50", contradicting `plan.md:164` ("0–20") and the shipped `MAX_OFFSET = 20`.
> **The code is authoritative: 0–20.** Likewise, docs that cite `2.71 pts/set`
> (e.g. `contract-surfaces.md:41`, `plan-brief.md`) describe the old `number=10`
> shape; the live per-set cost is **3.40** (`number=20`).

### Leak prevention #1 — the auth gate precedes any provider call

[`src/pages/api/proposals.ts:56-62`](src/pages/api/proposals.ts:56): the `POST`
handler checks `context.locals.user` and returns 401 **before** `buildColdStartSet`
is called ([`:69`](src/pages/api/proposals.ts:69)). The comment
([`:57-58`](src/pages/api/proposals.ts:57)) is explicit: middleware guards
`/dashboard` but not `/api/**`, "so this check is the only thing between an anonymous
request and a spent quota point." An anonymous POST spends **zero** quota — this is
a distinct leak face worth a unit assertion (the spike's verification row 3.3 checked
"401 and the quota counter unchanged").

### Failure mode — 402 when the budget is spent

When quota is exhausted the provider returns HTTP 402;
[`spoonacular.ts:101-102`](src/lib/spoonacular.ts:101) maps it to a typed
`{ ok: false, reason: "quota_exhausted", status: 402 }`, and the endpoint maps that
back to HTTP 402 ([`api/proposals.ts:10-15`](src/pages/api/proposals.ts:10),
`STATUS_BY_REASON`). This is exactly the "every user gets HTTP 402" outcome risk #1
describes — the app-wide failure once the shared 50-pt/day budget is drained.

### The two faces of risk #1 — current vs steady-state

Research surfaced that this risk has a **current** face and a **future** face; the
Phase 1 test should lock the current one without asserting a claim that will become
false:

- **Current (cold-start, shipped):** exactly 2 `complexSearch` calls; `getRecipeById`
  unused → 3.40 pts/set. **Testable now, deterministically.**
- **Future (steady-state slots 1/2, roadmap S-03/S-05, not built):** slots 1 and 2
  re-propose previously liked recipes whose display fields can't be stored (FR-011),
  so each will legitimately add a **1.00-pt** `GET /recipes/{id}/information` call.
  Budget rises to ~4.70 pts/set (`findings.md:27`). This is a *sanctioned* future
  increase, not a leak.

Implication for the test's phrasing: assert **"`buildColdStartSet` issues exactly
two `complexSearch` calls and zero by-id calls"** scoped to the cold-start function —
not a global "the app never calls `getRecipeById`", which will need editing the day
S-05 lands.

### Coverage today — what's already proven vs what's new

- **Manual, one-time:** verification 5.6 (`cold-start-proposals/verification.md:24`):
  "measured ≈ predicted **3.40** points (2 calls × `number=20`) — no extra provider
  call leaked in." Caveat (`verification.md:19`): operator-attested against the
  header, values not itemized into the repo.
- **Static guard:** the 0–900 offset clamp (impl-review F6).
- **Absent:** any automated test. No Vitest/MSW/`@testing-library`/`jsdom`, no `test`
  script, no `*.test.ts` (agent-verified across the whole repo). Bootstrapping the
  runner is part of Phase 1.

So the Phase 1 unit test is genuine new coverage: it turns a one-time manual
attestation into a **regression gate** that fires the moment a code change adds a
third call, drops the auth gate, or inflates `number`.

## The oracle for the Phase 1 unit test

What the test must assert (derived from PRD/formula/domain — **not** copied from the
code's own count):

1. **Call count, not contents.** `buildColdStartSet()` triggers **exactly two**
   `complexSearch` requests to the provider edge, and **zero** `/{id}/information`
   requests. The expected "2" comes from the domain rule *"one call per pinned
   cuisine, cold start pins 2 cuisines"* — not from reading `PER_CALL` or counting
   the loop.
2. **Per-call params.** Each of the two calls carries `number=20`,
   `addRecipeInformation=true`, a distinct pinned `cuisine`, `sort=random`, and
   `offset` in 0–20. (`addRecipeInformation=true` is what makes one call sufficient —
   no second per-recipe lookup — [`spoonacular.ts:122`](src/lib/spoonacular.ts:122).)
3. **Cost reconciles to the formula.** Predicted spend `= 2 × (1 + 0.035 × 20) = 3.40`
   pts. The unit layer asserts the **structure** (2 calls × `number=20`) from which
   3.40 follows by the formula; it should **not** hard-assert "3.40 observed" —
   actual points depend on how many recipes each call *returns* (thin cuisines return
   fewer), which is a live/integration concern, already attested once by 5.6.
4. **Auth gate.** An unauthenticated `POST /api/proposals` returns 401 and fires
   **zero** provider calls.
5. **Offset clamps (defense in depth).** `randomOffset()` ∈ [0, 20];
   `searchRecipes({ offset })` clamps any input to [0, 900].

Anti-patterns to avoid (from §2 guidance, confirmed applicable here):

- ❌ Asserting response *contents* / recipe count instead of the *call* count —
  result count is nearly free; the call count spends the budget.
- ❌ Copying the expected call count from the implementation (mirror test). "2" must
  come from the cuisine-pinning rule; "3.40" from the formula.
- ❌ A global "never calls `getRecipeById`" assertion — true today, but it encodes a
  claim that S-05 will legitimately break. Scope the assertion to the cold-start path.

**Cheapest-layer fit (unit):** the entire oracle is about *which requests leave the
app and with what params*. Stubbing the HTTP edge (MSW at the `complexSearch` URL,
per test-plan §4) or the `searchRecipes` boundary and counting/inspecting requests
gives a real signal deterministically, with no live quota spend. e2e would add cost
without adding signal for this specific risk.

## Code References

- `src/lib/spoonacular.ts:93` — the single provider `fetch`; the choke point for any call-count assertion.
- `src/lib/spoonacular.ts:121-133` — `searchRecipes` / `complexSearch`; `number`, `offset` (0–900 clamp at :126), `sort`, `addRecipeInformation=true` (:122) set here.
- `src/lib/spoonacular.ts:136-141` — `getRecipeById` / `/information`; the future steady-state call, currently 0 call sites.
- `src/lib/spoonacular.ts:39-49`, `:99` — `parseQuota` reads `X-API-Quota-Used/Request/Left` into `QuotaInfo`.
- `src/lib/spoonacular.ts:101-106` — 402 → `quota_exhausted`; other non-OK → `http_error`.
- `src/lib/spoonacular.ts:1` — `import { SPOONACULAR_API_KEY } from "astro:env/server"` (read once at module top; a test must stub this virtual module or resolve Astro's env plugin via `getViteConfig`).
- `src/lib/proposals.ts:20-28` — `PER_CALL=20`, `SET_SIZE=4`, `MAX_OFFSET=20` with the 2026-07-20 measurement rationale.
- `src/lib/proposals.ts:156-164` — `pickCuisinePair` (two distinct cuisines), `randomOffset` (0–20).
- `src/lib/proposals.ts:202-226` — `buildColdStartSet`: the two-call invariant, `Promise.all`, degrade-not-fail semantics.
- `src/pages/api/proposals.ts:56-69` — auth gate before the provider call; `buildColdStartSet` invocation.
- `src/pages/api/proposals.ts:10-15` — `STATUS_BY_REASON` (quota_exhausted → 402).
- `astro.config.mjs:17-23` — `SPOONACULAR_API_KEY` declared (server/secret/**optional**) — the `optional: true` is why `spoonacular.ts:81` guards `if (!SPOONACULAR_API_KEY)`. (CLAUDE.md's "not yet declared" note is stale.)
- `package.json:5-13,36-56` — no `test` script, no Vitest/MSW/testing-library/jsdom.

## Architecture Insights

- **A single fetch choke point** (`callApi`) makes risk #1 unusually cheap to test:
  every provider call — present or future — passes through one function, so
  intercepting/counting there catches any leak regardless of which wrapper added it.
- **Typed failure union, no throws.** `SpoonacularResult` models `quota_exhausted`,
  `http_error`, `not_configured`, `network_error` as data; the key-bearing URL is
  built, sent, and discarded, never logged or thrown ([`spoonacular.ts:76,94-98`](src/lib/spoonacular.ts:76)). A test asserts on `reason`, never on message strings.
- **Degrade, don't fail.** A single failed call yields a single-cuisine set
  (`degraded: true`) rather than an error ([`proposals.ts:211-225`](src/lib/proposals.ts:211)); only a double failure is an error. `degraded` reports *set coverage*, not call success — relevant to risk #5, adjacent here.
- **Cost is designed around the per-call base**: over-fetch (`number=20`) is cheap,
  a second call is expensive — the whole `buildColdStartSet` shape encodes that
  economics, which is precisely what the test must protect.

## Historical Context (from prior changes)

- `context/archive/2026-07-16-spoonacular-retrieval-spike/measurements.md` — the live cost measurements (M1–M5) that confirm the `1 + 0.035n` formula exactly; the oracle's empirical backbone.
- `context/archive/2026-07-16-spoonacular-retrieval-spike/findings.md:15-37` — "cost formula confirmed exactly"; "call count dominates"; "cold-start defaults to 2 cuisines"; steady-state 4.70-pt budget; ≤25 pt/day dev discipline.
- `context/changes/cold-start-proposals/plan.md:20,56,164,197,389,517` — the `number=20`/3.40-pt over-fetch decision, the offset measurement, and verification 5.6 ("no extra call leaked").
- `context/changes/cold-start-proposals/verification.md:19,24` — the operator attestation of ≈3.40 pts (values not itemized).
- `context/foundation/lessons.md` — timing-safe token guards (spike endpoint, now deleted) and shared-catalogue anon-key RLS (risk #7, adjacent).

## Related Research

- `context/changes/cold-start-proposals/research.md` — the S-02 engine's own research (retrieval + card render).
- Risk #4 (storage-field discipline) and risk #5 (request-side diversity) share this exact call path and will each get a research pass within Phase 1; this document deliberately scopes to the quota/call-count face only.

## Open Questions

1. **`number=20` per-call cost is interpolated, not directly measured** (spike used
   10 and 100). The formula is proven exact, so 1.70/call is trustworthy — but the
   3.40/set aggregate has only ever been *observed* live once (5.6, un-itemized).
   The unit test's deterministic oracle is therefore the **call structure**, leaving
   the predicted-vs-observed point reconciliation to the existing manual/live check.
2. **Stubbing `astro:env/server` in the runner** — `SPOONACULAR_API_KEY` is a virtual
   module import read at module top-level. Phase 1's runner setup must resolve it
   (Astro's `getViteConfig`) or mock the module. This is a harness-setup detail for
   `/10x-plan`, not a risk-#1 oracle question.
3. **When steady-state (S-03/S-05) lands**, the sanctioned budget rises to ~4.70
   pts/set via two by-id re-fetches. A *new* assertion will be needed then; the
   Phase 1 test should be scoped so it does not falsely fail at that point.
