# Spoonacular Retrieval & Quota Spike — Plan Brief

> Full plan: `context/changes/spoonacular-retrieval-spike/plan.md`

## What & Why

Roadmap item F-01: verify Spoonacular `complexSearch` works from the deployed Cloudflare Worker, measure what proposal sets *actually* cost against the free plan's 50-points/day quota, and sample how often publisher links are dead. The quota answer determines the schema and budget S-02 (`cold-start-proposals`) builds against — which is why this foundation runs before S-02 writes its migration.

## Starting Point

No Spoonacular code exists; `SPOONACULAR_API_KEY` sits unused in `.env.example`. Auth, deploy pipeline (push-to-master → wrangler deploy), and the `astro:env/server` secret pattern are all in place. Provider facts (endpoint, cost model, storage terms) were researched during the 2026-07-18 pivot and are banked in `change.md` — the spike implements them, it does not re-decide them.

## Desired End State

A working `src/lib/spoonacular.ts` client verified against production; `findings.md` with measured costs, sets-per-day arithmetic, a quota verdict (free plan viable or not), and a dead-link rate with fallback verdict; `docs/reference/contract-surfaces.md` seeded with the binding schema/UI constraints for S-02. The temporary spike endpoint is deleted.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Spike code fate | Keep `src/lib/spoonacular.ts`, delete the endpoint | The env-wiring and call-shape learning survives into S-02 without pretending the spike endpoint is a product surface. | Plan (user) |
| Quota spend cap | ≤25 points/day | All measurements fit in one day (~15 pts) with headroom left for ad-hoc dev use. | Plan (user) |
| Locale-fit unknown | Deferred entirely | User decision 2026-07-18: real usage after S-02 answers it; recorded in findings so it isn't silently lost. | Plan (user) |
| Endpoint guarding | `x-spike-token` header vs `SPIKE_TOKEN` secret, 401 otherwise | Middleware leaves `/api/*` public and an open endpoint on workers.dev lets strangers drain the 50-point quota. | Plan |
| Measurement instrument | `X-API-Quota-*` response headers, deltas between calls | More trustworthy than the documented formula — and confirming the formula is the measurement. | Plan |
| Provider facts | Not re-researched | Endpoint, cost model, and storage terms are settled in change.md §Known before starting. | change.md |

## Scope

**In scope:** env schema entries, minimal typed client (search + by-id, quota telemetry, 402 as typed outcome), token-guarded spike endpoint, deploy, 5-step measurement protocol (~15 pts), ~50-URL liveness check, findings.md, contract-surfaces.md, spike-surface cleanup.

**Out of scope:** database schema/migrations, proposal UI or slot logic, locale evaluation (deferred), any provider-field caching, deliberate 402 triggering, committing scratch dumps, retitling GitHub issue #1.

## Architecture / Approach

`src/pages/api/spike/spoonacular.ts` (temporary, token-guarded, JSON) → `src/lib/spoonacular.ts` (surviving artifact) → Spoonacular REST. Measurements are driven by curl against local dev, then the production URL; the liveness check runs as a local throwaway script over a gitignored `spoon.json` dump, costing zero quota beyond the one over-fetched call that produced it.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Wire the client locally | Lib + guarded endpoint working against the real API from dev | First JSON endpoint in the repo — no in-repo precedent to copy |
| 2. Deploy and measure | Production verification + all raw numbers (M1–M5, liveness) | Secrets must be `wrangler secret put` **before** merge, or the endpoint arrives broken |
| 3. Findings, constraints, cleanup | findings.md verdicts + contract-surfaces.md + spike removal | Verdict-dodging — findings must decide, not restate the question |

**Prerequisites:** Spoonacular free-plan API key in hand; `wrangler` authenticated against the `co-jemy` Worker.
**Estimated effort:** ~2 short sessions — Phase 1 in one, Phases 2–3 in the next (measurement is quota-gated, not effort-gated).

## Open Risks & Assumptions

- If measured costs diverge >20% from the ~1 + 0.035n formula, the sets-per-day arithmetic — and possibly the free-plan viability verdict — changes.
- The locale-fit question is deliberately unexamined; it remains the unknown most likely to invalidate the product experience, now scheduled to surface post-S-02.
- Assumes `astro:env/server` secrets resolve correctly on the deployed Worker (the documented `nodejs_compat_populate_process_env` fallback exists if not).

## Success Criteria (Summary)

- A recipe search demonstrably works on the production URL, with quota telemetry captured
- findings.md answers the quota and dead-link unknowns with measured numbers and explicit verdicts
- S-02 can start from contract-surfaces.md + `src/lib/spoonacular.ts` without re-opening any provider question
