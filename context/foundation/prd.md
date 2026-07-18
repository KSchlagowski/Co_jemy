---
project: "Co jemy?"
version: 1
status: draft
created: 2026-05-30
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: 2026-07-05
  after_hours_only: true
---

## Vision & Problem Statement

Not planning meals leads to time wasted at the grocery store and in front of the fridge, food thrown away unused, and a default toward processed food even when the person has the desire to cook but is mentally too tired to plan. The person has willingness — they just can't make the decision.

The insight: existing recipe tools don't adapt to what the user actually cooked and liked. Search engines return the same generic results every time; aggregator sites overwhelm with choice, which makes the decision harder, not easier. An app that learns from a simple 👍/👎 signal over time — and reduces the proposal set to a curated handful rather than expanding it — solves both the personalization gap and the friction-of-choice problem simultaneously.

## User & Persona

An adult living alone or with a partner who cooks regularly (3–5 times per week) but informally. Not a food enthusiast chasing novelty, not a beginner needing step-by-step guidance. Someone who knows their way around a kitchen but finds the "what should I cook tonight?" decision mentally draining — especially at the end of a busy day. They have preferences, but those preferences live in their head, not in a list anywhere. The app's job is to make the decision for them.

## Success Criteria

### Primary
The full feedback loop works end-to-end: the user requests proposals → sees up to 4 suggestions → clicks one and gets the external recipe link → returns and rates it 👍 or 👎 → future proposals are observably influenced by that rating history.

### Secondary
The 4-slot proposal logic works correctly — slot 1 surfaces a recently liked recipe, slot 2 resurfaces a liked recipe not seen in ≥2 weeks, slot 3 proposes something new that fits the inferred taste profile, slot 4 introduces a random outlier for discovery.

### Guardrails
Rating data must persist reliably across sessions. Losing a user's rating history destroys the core value loop — the app becomes indistinguishable from random recipe search without it.

One structural caveat introduced by the Spoonacular pivot: the provider's terms state that if API access stops or is suspended, all data ever obtained from the API must be deleted. On a plain reading that reaches the stored recipe ids, titles, and image URLs. To keep a provider dispute from gutting the guardrail, the user's own rating events (user, verdict, timestamp) are stored as a table logically separate from the provider-derived recipe reference, so the irreplaceable half of the history survives even if the derived half must be purged.

## User Stories

### US-01: Returning user gets personalized proposals

- **Given** a logged-in user with at least one saved rating
- **When** they request a new set of proposals
- **Then** they see up to 4 recipe suggestions whose selection is influenced by their rating history, each with a title, brief description, and a source link to the external recipe page

#### Acceptance Criteria
- A recipe rated 👎 never appears in proposals
- At least one proposal slot reflects a previously liked recipe (if rating history supports it)
- Each proposal card includes a working external link

### US-02: New user gets diverse discovery proposals

- **Given** a newly registered user with no ratings
- **When** they request their first set of proposals
- **Then** they see 4 randomly selected recipes from diverse cuisines to seed their taste profile

#### Acceptance Criteria
- Cold-start proposals span at least 2 different cuisine types
- The empty-state does not feel like an error — it communicates that proposals improve as they rate

## Functional Requirements

### Authentication

- FR-001: User can register with email + password. Priority: must-have.
  > Socrates: Counter-argument considered: "auth adds 1–2 days build time before anyone else uses the app." Resolution: kept — ratings must be tied to an identity; without auth there is no taste profile, and the core loop cannot work across sessions.

- FR-002: User can log in and log out. Priority: must-have.
  > Socrates: Part of FR-001/002 bundle. Same resolution applies.

### Recipe Discovery

- FR-003: User can request a set of recipe proposals; each proposal includes a title, brief description, and a source link to the external recipe. The **Spoonacular Food API (free plan)** is the retrieval mechanism for v1 — a `GET /recipes/complexSearch` call with `addRecipeInformation=true` returns every field a proposal card needs, with no second lookup per recipe. (Field completeness, not call count — cuisine diversity still costs one call per pinned cuisine; see Business Logic.) The free plan's 50-points/day quota and the provider's data-storage terms (see FR-011) are the accepted MVP constraints. Priority: must-have.
  > Socrates: *Superseded 2026-07-18.* The v1 counter-argument was "live AI search is slow and may return broken links — this could undermine the whole app," accepted as a risk. The pivot to Spoonacular retires it: a curated corpus behind a REST call eliminates both the latency risk and fabricated links. The replacement counter-argument is sharper than it first looked: "a 50-points/day free quota caps the entire app at roughly 10–21 proposal sets per day across all users combined." Resolution: accepted only provisionally, and flagged as Open Question 1 — this is tight enough that development testing competes with real use, and the $29/mo tier may prove necessary before launch rather than after. Merged external-link FR: a proposal always includes a link; no separate "open link" FR needed.

- FR-010: Every proposal credits the original recipe publisher by name and links to that publisher's page. Priority: must-have.
  > Socrates: Not a product preference — Spoonacular's terms require crediting the original source "in the same manner" spoonacular does, i.e. the publisher name (`sourceName`) plus a hyperlink (`sourceUrl`). Counter-argument considered: "this is card-design detail, not a requirement." Resolution: kept as an FR because omitting it is a licence breach rather than a UI regression, and it must survive any future redesign of the proposal card. The primary link must target `sourceUrl` (the external publisher); `spoonacularSourceUrl` is permitted only as a fallback when `sourceUrl` is absent or unreachable (see NFRs). The `sourceName` credit is displayed either way — when the publisher hyperlink cannot be honored, the visible publisher name is what still satisfies the licence.

- FR-011: The app stores only a recipe's Spoonacular id, title, and image URL; every other recipe field is fetched live and never persisted. Priority: must-have.
  > Socrates: Counter-argument considered: "caching descriptions locally would cut quota use and latency dramatically." Resolution: rejected — the provider's terms permit indefinite storage of exactly those three fields and cap all other data at a 1-hour cache that additionally requires *prior written permission*. This constrains the schema, so it belongs in the PRD rather than surfacing as an implementation surprise. Fortunately the 4-slot logic (FR-008) and 👎-exclusion (FR-009) need only ids, timestamps, and the cuisine the app itself requested — that last one being the app's own request data rather than a provider recipe field, and therefore outside this limit entirely — so the permitted set is sufficient.

### Rating System

- FR-004: User can rate a recipe 👍 or 👎. Priority: must-have.
  > Socrates: CRUD create. No counter-argument raised.

- FR-005: User can view their list of rated recipes. Priority: must-have.
  > Socrates: CRUD read. No counter-argument raised.

- FR-006: User can change an existing rating (👍 → 👎 or vice versa). Priority: must-have.
  > Socrates: CRUD update. No counter-argument raised.

- FR-007: User can delete a rating, returning the recipe to "new" / unrated status. Priority: must-have.
  > Socrates: Counter-argument considered: "delete means the app forgets a like or dislike — could re-propose something the user hated." Resolution: full reset; deletion is an intentional 'give it another chance' action. The app trusts the user's intent.

### Recommendation Logic

- FR-008: App generates up to 4 proposal slots using 4-slot classification: slot 1 = recently liked recipe; slot 2 = liked recipe not proposed in ≥2 weeks; slot 3 = new recipe matching inferred taste profile; slot 4 = random discovery. Cold-start behavior: all 4 slots filled randomly from diverse cuisines until sufficient rating history accumulates to activate slot-specific logic. Priority: must-have.
  > Socrates: Counter-argument considered: "with fewer than 5–10 ratings, slot 3 has no reliable taste signal." Resolution: cold-start fills all slots randomly; logic activates progressively as data accumulates. Simple fallback, honest UX.

- FR-009: App permanently excludes recipes rated 👎 from proposal slots. Users who change their mind delete the rating (FR-007) to reset. Priority: must-have.
  > Socrates: Counter-argument considered: "tastes change — permanent exclusion may feel too strict after a year." Resolution: permanent for MVP; FR-007 (delete) is the user-controlled override. Timed expiry is out of scope.

## Non-Functional Requirements

- The app works on a phone browser without a native app: web-only product, mobile-responsive layout required.
- If a recipe source link is unreachable at the time the user clicks it, the app signals the problem to the user rather than producing a silent dead click. Spoonacular returns a provider-hosted `spoonacularSourceUrl` alongside the publisher's `sourceUrl`; it is the fallback when the publisher link has rotted. The same applies to recipe images, whose URLs can also rot — cards need a graceful image fallback, not a broken thumbnail.
- Recipe descriptions arrive as HTML containing the provider's own `<b>` tags and `<a>` links back to spoonacular.com. The app strips markup and truncates to a short excerpt before rendering; it never injects third-party anchors into its own pages.

## Business Logic

The app classifies recipe candidates against the user's 👍/👎 rating history to assemble a proposal set that balances familiarity (a recently liked recipe), memory (a forgotten favorite not seen in ≥2 weeks), growth (a new recipe that fits the inferred taste profile), and discovery (a random outlier from any cuisine) — with no more than 4 proposals per session.

Inputs are the user's rating history and a pool of recipe candidates retrieved from the Spoonacular Food API. The output is an ordered proposal set of up to 4 recipes, each with a source link. The user encounters this rule each time they tap "give me proposals": the app makes the meal-selection decision so the user doesn't have to. In the cold-start case (insufficient rating history), all 4 slots are filled randomly from diverse cuisines to seed the taste profile; slot-specific logic activates progressively as ratings accumulate.

Cuisine diversity is established on the **request** side, not the response side: the app issues searches pinned to chosen `cuisine` values and records which cuisine it asked for. Spoonacular's returned `cuisines[]` array is a derived classification that is often empty even for recipes that plainly belong to a cuisine, so reading diversity back out of the response would silently under-deliver on US-02's acceptance criterion. Variety across repeated calls comes from `sort=random` combined with a varied `offset` (capped at 900 by the provider, so a single filter combination exposes at most ~1,000 addressable recipes).

This has a direct cost consequence, because the provider charges a full point of base cost **per call** and only fractions per result. One pinned cuisine means one call, so a cold-start set satisfying US-02's two-cuisine minimum costs at least two calls, and pinning all four slots to different cuisines costs four. At 1 point + 0.035/recipe returned, that is roughly 2.4 points for a two-cuisine set and 4.7 for a four-cuisine one — meaning the free plan's 50 points/day supports on the order of 10–21 proposal sets across all users, not the ~45 a naive single-call estimate suggests. Steady-state sets add more: slots 1 and 2 re-propose previously liked recipes, whose descriptions cannot be stored under FR-011 and so must be re-fetched by id at 1 point each. Over-fetching results within a call is nearly free; adding calls is not. Design accordingly.

The rule the app applies is classification: does this candidate recipe belong in slot 1 (liked recently), slot 2 (liked but not seen in ≥2 weeks), slot 3 (new but taste-compatible), or slot 4 (random outlier)? 👎-rated recipes are permanently excluded from all slots.

## Access Control

Email + password authentication. Registration is open (no invite gate for MVP). All logged-in users have equal access — flat user model, no roles, no admin interface. Unauthenticated users cannot access proposals, ratings, or any personalized content.

## Non-Goals

- **No own recipe content**: the app hosts no recipe bodies — it never copies or stores ingredients, instructions, or nutrition data, never reproduces full recipe text, and always links out to the external source for the recipe itself. What it does show is a short description excerpt and a hotlinked thumbnail; what it persists is only the id, title, and image URL (FR-011). Avoids copyright complexity and content-ingestion scope entirely. The Spoonacular pivot *reinforces* this non-goal rather than straining it: the provider's terms independently forbid storing ingredients, instructions, or nutrition data in any form, including derived or transformed copies.
- **No shopping list generation**: users manage their own purchasing. Explicit scope boundary.
- **No macro or nutritional data**: the app makes no health claims or calculations. Avoids a regulatory and data complexity domain. Watch one passive breach: Spoonacular's `summary` field routinely embeds calorie and macro figures inline, so rendering it verbatim would violate this non-goal without anyone deciding to. The excerpt must be trimmed deliberately, and `includeNutrition` / `addRecipeNutrition` stay off (they also cost extra quota).
- **No native mobile app**: web-only for MVP; mobile-responsive web covers phone browser use.
- **No advanced recommendation algorithm**: v1 uses 4 hand-coded slot rules, not a machine-learning model. Right-sized for the delivery timeline.
- **No recipe import**: users cannot add their own recipes to the proposal pool.
- **No portion scaling or recalculation**: recipes are shown as-is from external sources.
- **No multi-user / shared profiles**: each account is individual; no household or family sharing.

## Open Questions

The discovery session (2026-05-26) closed with no open questions. The retrieval pivot to Spoonacular (2026-07-18) opened three; all are scheduled against the `spoonacular-retrieval-spike` foundation item rather than blocking the PRD.

1. **Does the free plan's 50-points/day quota survive development?** Because base cost is charged per call and cuisine diversity forces one call per pinned cuisine, a proposal set costs roughly 2.4–4.7 points — on the order of 10–21 sets per day across all users, before counting the re-fetches that steady-state slots 1 and 2 require. Development and testing draw from the same budget, so a single afternoon of iteration can exhaust a day's quota. This is the tightest constraint the pivot introduced; measuring it precisely is the F-01 spike's highest-value output. If it does not hold, the choice is the $29/mo tier (1,500 points/day) or a request-shaping change such as serving fewer cuisines per set. Owner: user. Block: no.
2. **Does an English-language, largely US-centric recipe corpus serve a Polish-speaking user well?** US-02's "at least 2 cuisines" criterion will pass on a corpus that is nonetheless a poor everyday fit, so the acceptance criterion cannot detect this failure. It bites hardest at cold start, where there is no personalization to compensate. Owner: user. Block: no, but it is the question most likely to invalidate the product experience.
3. **How reliably does `sourceUrl` point at a live external publisher?** Determines whether the dead-link NFR needs an active reachability check or only a graceful error state. Owner: team. Block: no.
