# Spoonacular Retrieval Spike — Findings

Date: 2026-07-19. Raw data: `measurements.md` (same folder). All measurements taken against the deployed Worker (`co-jemy.mediewilnp.workers.dev`), quota telemetry read from the `X-API-Quota-*` response headers.

## 1. Measured cost (M1–M5)

| Step | What | Predicted (1 + 0.035n) | Measured | Deviation |
| --- | --- | --- | --- | --- |
| M1 | Smoke, `number=1` | 1.035 | **1.03** | ~0% |
| M2 | 2-cuisine cold-start set (2 calls, `number=10`) | ~2.70 | **2.71** | ~0% |
| M3 | 4-cuisine cold-start set (4 calls, `number=10`) | ~5.40 | **5.40** | 0% |
| M4 | Over-fetch, 1 call `number=100` | 4.50 | **4.50** | 0% |
| M5 | Re-fetch by id (`/recipes/{id}/information`) | 1.00 | **1.00** | 0% |

Total spike spend: 14.64 points (cap was ≤25). **The documented cost formula is confirmed exactly** — no divergence anywhere, so all quota arithmetic in the PRD stands as written. `quota.request` matched the per-call delta on every response; the headers are a reliable measurement instrument for runtime budget tracking.

The call-count-dominates rule is starkly visible in the data: 100 recipes in one call cost 4.50 points, while 40 recipes across four calls cost 5.40. Over-fetching within a call is nearly free; adding calls is not.

## 2. Sets-per-day arithmetic (50 points/day, free plan)

| Set shape | Cost per set | Sets/day (all users combined) |
| --- | --- | --- |
| Cold-start, 2 cuisines (US-02 minimum) | 2.71 | **~18** |
| Cold-start, 4 cuisines (full diversity) | 5.40 | **~9** |
| Steady-state 4-slot set (see below) | ~4.70 | **~10** |

**Steady-state set cost**: slots 1 and 2 re-propose previously liked recipes whose display fields cannot be stored (FR-011), so each costs a 1.00-point by-id re-fetch (M5). Slots 3 and 4 need one pinned `complexSearch` each at ~1.35 (`number=10`). Total ≈ 1.00 + 1.00 + 1.35 + 1.35 = **4.70 points/set** — the PRD's 2.4–4.7 estimate lands at its upper end for steady state.

Development draw is real: the Phase 2 protocol alone spent 14.64 points (29% of a day). An afternoon of S-02 iteration making 20–30 calls will consume most or all of a day's budget — development and real use genuinely compete, as Open Question 1 suspected.

## 3. Quota verdict (Unknown 1) — **decision**

**Stay on the free plan through S-02; do not buy the $29/mo tier yet.** Adopt these request-shaping rules as binding for S-02:

1. **Cold-start defaults to 2 cuisines, not 4.** 2.71 vs 5.40 points doubles the daily set capacity, and US-02's acceptance criterion only requires 2. Serve 4-cuisine diversity across *successive* requests (different pair each time) rather than within one request.
2. **Over-fetch within calls**: request `number=20` or more per pinned call (marginal cost 0.035/recipe) and draw multiple slots/sessions from the surplus rather than issuing new calls.
3. **Development discipline continues**: keep the ≤25 points/day dev cap; treat 402 as an expected typed outcome (already implemented in `src/lib/spoonacular.ts`).
4. **Upgrade trigger, defined now**: move to the $29/mo tier (1,500 points/day) when either (a) real usage regularly exceeds ~10 sets/day across users, or (b) development hits 402 more than once in a week despite the cap. Until then the free plan supports a single-user/few-user MVP plus disciplined development.

## 4. `sourceUrl` liveness (Unknown 3) — **verdict**

Sample: 50 distinct `sourceUrl`s from the M4 dump (HEAD with GET fallback, redirects followed, 10s timeout).

| Metric | Value |
| --- | --- |
| Alive | 49/50 (98.0%) |
| Dead | 1/50 (2.0%) |
| `spoonacularSourceUrl` alive for the dead link | 1/1 |

**NFR recommendation: graceful error state, no active reachability check.** A 2% dead rate does not justify spending latency (or complexity) probing links before render. S-02 should: link cards to `sourceUrl`; when `sourceUrl` is absent use `spoonacularSourceUrl` as the documented fallback; keep the image `onerror` fallback for rotted thumbnails. The provider-hosted fallback demonstrably works when the publisher page has rotted.

Caveat: the sample (no cuisine filter, default sort) skews toward foodista.com — it measures the default corpus slice, not a per-publisher rate. Good enough to pick the NFR posture; not a guarantee for every publisher.

## 5. Locale/corpus fit (Unknown 2) — deferred

**Deferred by user decision 2026-07-18.** Whether an English-language, largely US-centric corpus serves a Polish-speaking user well cannot be measured by an API probe; real usage after S-02 will answer it. Recorded here so the unknown is not silently lost. One incidental positive signal: every cuisine-pinned call (italian, mexican, chinese, greek, thai, french) returned a full 10 results, and `number=100` returned a full 100 — corpus *depth* was never the binding constraint at this sample size.

## 6. What survives this spike

- `src/lib/spoonacular.ts` — the typed client S-02 imports (`searchRecipes`, `getRecipeById`, `SpoonacularResult` with quota telemetry and typed 402).
- `SPOONACULAR_API_KEY` Worker secret and env-schema entry.
- `docs/reference/contract-surfaces.md` — the binding schema/UI constraints for S-02.
- The spike endpoint (`/api/spike/spoonacular`) and `SPIKE_TOKEN` are deleted.
