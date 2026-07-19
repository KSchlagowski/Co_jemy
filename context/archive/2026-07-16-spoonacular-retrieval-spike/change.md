---
change_id: spoonacular-retrieval-spike
title: Verify Spoonacular retrieval, quota, and terms in the deployed Worker
status: archived
created: 2026-07-16
updated: 2026-07-19
archived_at: 2026-07-19T05:42:22Z
---

## Notes

Roadmap item **F-01** (`context/foundation/roadmap.md` → Foundations), the first item in Stream A (proposal engine) and the prerequisite for S-02 (north star).

- **Outcome:** a `fetch`-based Spoonacular call is verified working in the deployed Worker and returns usable recipe candidates (title, description, `sourceUrl`, image); the free-tier point cost of one proposal set is measured, and the provider's storage/attribution obligations are written down as concrete schema and UI constraints.
- **PRD refs:** FR-003, FR-010, FR-011
- **Unlocks:** S-02 (`cold-start-proposals`), transitively S-05
- **Backlog:** [#1](https://github.com/KSchlagowski/Co_jemy/issues/1)

### History

Renamed from `ai-search-retrieval-spike` on 2026-07-18. The original spike existed to answer "which AI web-search provider works on the Workers runtime?" — a question the pivot to the Spoonacular Food API dissolves entirely: it is a plain HTTPS REST endpoint called with global `fetch`, with no `nodejs_compat` surface at all. No work had landed against the old identity, so it was renamed in place rather than archived. The item was retained rather than deleted because three genuine unknowns remain, and the quota question among them determines the schema — meaning it must resolve *before* S-02 writes a migration, which is exactly what a foundation item is for.

### Unknowns to resolve (this is the work)

Three, matching PRD §Open Questions and roadmap F-01.

1. **Quota headroom** — schema-determining, highest value. Measure the real point cost of assembling one full 4-slot proposal set against the free plan's 50 points/day. Because base cost is charged per call and cuisine diversity forces one call per pinned cuisine, the estimate is ~2.4–4.7 points per set — on the order of 10–21 sets/day across all users. Confirm that, and decide whether steady-state slots 1 and 2 can afford to re-fetch by id at 1 point each. Also establish whether development testing alone can exhaust a day's budget. Owner: user.
2. **Catalogue and locale coverage** — confirm the corpus satisfies US-02's "at least 2 cuisines", and assess whether an English-language, largely US-centric corpus serves a Polish-speaking user well enough for the product to work at all. This is the question no document previously owned, and the one most likely to invalidate the experience. Owner: user.
3. **`sourceUrl` liveness** — sample ~50 recipes, measure the dead-link rate, confirm `spoonacularSourceUrl` works as a fallback. Calibrates whether the NFR needs an active reachability check or a graceful error state. Owner: team.

### Why still first

The retrieval-feasibility risk is gone, but the *economics* and *content-rights* risks that replaced it are load-bearing on the schema S-02 will write. Verifying in the deployed Worker also keeps the original discipline: confirm against production, not just local dev.

### Known before starting

Established by research on 2026-07-18 — do not re-litigate:

- `GET /recipes/complexSearch` with `addRecipeInformation=true` is the single primary endpoint; it returns `sourceUrl`, `sourceName`, `spoonacularSourceUrl`, `summary`, `cuisines[]`, `dishTypes[]` in one call. Without that flag the response carries only id/title/image and every card would need a second call.
- Cost model: 1 point base **per call** + 0.01/result, plus 0.025/recipe for `addRecipeInformation` — so ~1 + 0.035n per call. Call count dominates; over-fetching within a call is nearly free. Minimize calls, never one per slot.
- **Terms are settled, not an open question** — researched and encoded as PRD FR-010 and FR-011. Only recipe id, title, and image URL may be stored indefinitely; all other fields (including `summary`, `cuisines[]`, `dishTypes[]`) may not be persisted in any derived or transformed form, and caching them requires prior written permission and expires after 1 hour. Attribution is to the *original publisher* (`sourceName` + link to `sourceUrl`), not to Spoonacular; a Spoonacular backlink is required only for invited hackathon/academic plans. The spike implements these, it does not re-decide them.
- `sort=random` plus a varied `offset` (0–900) is the documented variety mechanism.
- `cuisines[]` is a derived field and is often empty; drive cuisine from the request side and record what was asked for.
- Auth is an `apiKey` query parameter — server-side only, as a Worker secret.
