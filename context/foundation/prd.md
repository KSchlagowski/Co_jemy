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

- FR-003: User can request a set of recipe proposals; each proposal includes a title, brief description, and a source link to the external recipe. Live AI-powered web search is the retrieval mechanism for v1; link quality and search latency are accepted MVP risks. Priority: must-have.
  > Socrates: Counter-argument considered: "live AI search is slow and may return broken links — this could undermine the whole app." Resolution: accepted risk for v1; iterate once real usage surfaces the failure patterns. Merged external-link FR: a proposal always includes a link; no separate "open link" FR needed.

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
- If a recipe source link is unreachable at the time the user clicks it, the app signals the problem to the user rather than producing a silent dead click.

## Business Logic

The app classifies recipe candidates against the user's 👍/👎 rating history to assemble a proposal set that balances familiarity (a recently liked recipe), memory (a forgotten favorite not seen in ≥2 weeks), growth (a new recipe that fits the inferred taste profile), and discovery (a random outlier from any cuisine) — with no more than 4 proposals per session.

Inputs are the user's rating history and a pool of recipes retrieved via AI-powered web search. The output is an ordered proposal set of up to 4 recipes, each with a source link. The user encounters this rule each time they tap "give me proposals": the app makes the meal-selection decision so the user doesn't have to. In the cold-start case (insufficient rating history), all 4 slots are filled randomly from diverse cuisines to seed the taste profile; slot-specific logic activates progressively as ratings accumulate.

The rule the app applies is classification: does this candidate recipe belong in slot 1 (liked recently), slot 2 (liked but not seen in ≥2 weeks), slot 3 (new but taste-compatible), or slot 4 (random outlier)? 👎-rated recipes are permanently excluded from all slots.

## Access Control

Email + password authentication. Registration is open (no invite gate for MVP). All logged-in users have equal access — flat user model, no roles, no admin interface. Unauthenticated users cannot access proposals, ratings, or any personalized content.

## Non-Goals

- **No own recipe content**: the app links to external sites only; it never copies, stores, or displays recipe text or images. Avoids copyright complexity and content-ingestion scope entirely.
- **No shopping list generation**: users manage their own purchasing. Explicit scope boundary.
- **No macro or nutritional data**: the app makes no health claims or calculations. Avoids a regulatory and data complexity domain.
- **No native mobile app**: web-only for MVP; mobile-responsive web covers phone browser use.
- **No advanced recommendation algorithm**: v1 uses 4 hand-coded slot rules, not a machine-learning model. Right-sized for the delivery timeline.
- **No recipe import**: users cannot add their own recipes to the proposal pool.
- **No portion scaling or recalculation**: recipes are shown as-is from external sources.
- **No multi-user / shared profiles**: each account is individual; no household or family sharing.

## Open Questions

No open questions. All shaping decisions were resolved during the discovery session (2026-05-26).
