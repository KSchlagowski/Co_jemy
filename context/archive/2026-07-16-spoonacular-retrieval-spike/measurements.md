# Phase 2 raw measurements — 2026-07-19

Production endpoint: `https://co-jemy.mediewilnp.workers.dev/api/spike/spoonacular` (deployed via CI run 29657280892, green). Quota day started fresh; `quota.used` values below are the provider's running daily total from the `X-API-Quota-Used` header. All calls `addRecipeInformation=true`, no nutrition flags.

## M-step cost table

| Step | Call(s) | quota.used after | Δ measured | Predicted (1 + 0.035n) | Deviation |
| --- | --- | --- | --- | --- | --- |
| M1 smoke | `number=1` | 1.03 | **1.03** | 1.035 | ~0% |
| M2a | `cuisine=italian&number=10&sort=random` | 2.38 | 1.35 | 1.35 | 0% |
| M2b | `cuisine=mexican&number=10&sort=random` | 3.74 | 1.36 | 1.35 | ~0% |
| **M2 total (2-cuisine set)** | 2 calls | — | **2.71** | ~2.7 | ~0% |
| M3a–d | chinese / greek / thai / french, `number=10&sort=random` | 5.09 / 6.44 / 7.79 / 9.14 | 1.35 each | 1.35 each | 0% |
| **M3 total (4-cuisine set)** | 4 calls | — | **5.40** | ~5.4 | 0% |
| M4 over-fetch | `number=100` | 13.64 | **4.50** | 4.5 | 0% |
| M5 re-fetch by id | `id=715415` (`/recipes/{id}/information`) | 14.64 | **1.00** | 1.0 | 0% |

**Total spend: 14.64 points** (cap was ≤25). `quota.left` ended at 35.37.

Additional observations:

- Every response carried parseable `X-API-Quota-Used` / `X-API-Quota-Request` / `X-API-Quota-Left` headers; `quota.request` matched the per-call delta every time. The documented cost formula is confirmed exactly — no >20% divergence, the sets-per-day arithmetic in the PRD stands.
- Guard check (zero quota): request without `x-spike-token` → 401 from production.
- All 6 cuisine-pinned calls returned a full 10 recipes each; `number=100` returned a full 100 — corpus depth was never the binding constraint at this sample size.

## Liveness sample (zero quota — probes publisher URLs from the M4 `spoon.json` dump)

Method: HEAD with GET fallback, redirects followed, 10s timeout, 50 distinct `sourceUrl`s.

| Metric | Value |
| --- | --- |
| Total checked | 50 |
| Alive | 49 (98.0%) |
| Dead | 1 (2.0%) |
| Fallback (`spoonacularSourceUrl`) alive for dead links | 1/1 |

The single dead link: `https://pickfreshfoods.com/broccolini-quinoa-pilaf/` → 404; its `spoonacularSourceUrl` → 200.

Caveat for findings: the M4 dump (no cuisine filter, default sort) skews heavily toward foodista.com — the sample measures the default corpus slice, not a per-publisher rate.
