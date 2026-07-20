# Contract Surfaces — load-bearing names registry

Names and constraints that later changes must not silently break. Seeded by the `spoonacular-retrieval-spike` change (2026-07-19); grows as changes land. Sources: PRD FR-010/FR-011, Spoonacular terms (researched 2026-07-18), measured spike data (`context/archive/2026-07-16-spoonacular-retrieval-spike/findings.md`).

## Spoonacular data: what may be persisted

**Storable indefinitely** (the provider's terms permit exactly these recipe fields):

| Field | Notes |
| --- | --- |
| `spoonacular_id` | The provider's recipe `id`; the re-fetch key for steady-state slots 1–2 |
| `title` | Verbatim |
| `image` URL | Hotlinked, never re-hosted |

**Also storable — app-side request facets** (not provider recipe data, so outside FR-011's limit entirely):

| Field | Notes |
| --- | --- |
| requested `cuisine` | The cuisine the app pinned in its own `complexSearch` request. Drives diversity accounting — the response's `cuisines[]` is derived and often empty, so never read diversity from the response |
| requested `type` | Same reasoning, if used |
| proposed-at timestamp | App's own event data; powers the slot-2 "not seen in ≥2 weeks" rule |

Rating events (user, verdict, timestamp) are the app's own data and live in a table logically separate from the provider-derived recipe reference, so they survive a forced provider-data purge (PRD §Guardrails).

**Prohibited to persist in any form, including derived/transformed**: `summary`, `cuisines[]`, `dishTypes[]`, ingredients, instructions, nutrition, and every other provider field. Caching them requires prior written permission and expires after 1 hour — treat as unavailable. Display fields for previously-liked recipes are re-fetched live by id (measured cost: 1.00 point/recipe).

## Attribution contract (FR-010 — licence, not preference)

- Every card displays the publisher name (`sourceName`) and links to the publisher page (`sourceUrl`).
- `spoonacularSourceUrl` is permitted **only** as a fallback when `sourceUrl` is absent or dead (measured: 98% of `sourceUrl`s alive; the fallback worked for the one dead link).
- The `sourceName` credit is displayed even when the publisher hyperlink cannot be honored.

## Summary display rule

`summary` arrives as HTML with the provider's `<b>` tags and `<a>` backlinks, and routinely embeds calorie/macro figures. Before render: strip all markup, truncate to a short excerpt, and drop nutrition figures (the no-macros non-goal). Never inject the provider's anchors into our pages. Never send `includeNutrition`/`addRecipeNutrition`.

## Quota budget per proposal set (measured 2026-07-19, free plan = 50 points/day)

| Set shape | Points | Sets/day |
| --- | --- | --- |
| Cold-start, 2 cuisines (default per findings.md) | 2.71 | ~18 |
| Cold-start, 4 cuisines | 5.40 | ~9 |
| Steady-state 4-slot (2 by-id re-fetches + 2 searches) | ~4.70 | ~10 |

Cost model confirmed exact: 1 point/call + 0.035/recipe returned. Calls dominate — over-fetch within a call (`number=20+`), never add calls. One `complexSearch` call per pinned cuisine is the floor. HTTP 402 = quota spent; it is a typed, expected outcome.

## `src/lib/spoonacular.ts` public surface

- `searchRecipes(params: { cuisine?; number?; offset?; sort?: "random" }): Promise<SpoonacularResult>` — always sends `addRecipeInformation=true`, never nutrition flags. `offset` is clamped to 0–900 in code (provider cap).
- `getRecipeById(id: number): Promise<SpoonacularResult>` — the slots-1/2 re-fetch path.
- `SpoonacularResult` — discriminated union: `{ ok: true; recipes: RecipeCandidate[]; quota?: QuotaInfo }` | `{ ok: false; reason: "quota_exhausted" | "http_error" | "not_configured" | "network_error"; status; quota? }`.
- `RecipeCandidate` — only what a card needs: `id`, `title`, `image`, `summary`, `sourceName`, `sourceUrl`, `spoonacularSourceUrl`.
- `QuotaInfo` — `{ used, request, left }` from the `X-API-Quota-*` headers; use it for runtime budget tracking. `quota` is absent (undefined) when the provider omits or blanks the headers — never guessed.
- The `apiKey` travels as a query param: the module never logs, throws, or returns a URL containing it — fetch/parse failures are caught and returned as typed `network_error` results. Keep it that way.
