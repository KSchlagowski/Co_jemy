---
project: "Co jemy?"
version: 1
status: draft
created: 2026-07-14
updated: 2026-08-09
prd_version: 1
main_goal: learn
top_blocker: skills
---

# Roadmap: Co jemy?

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Meal-decision fatigue wastes time and food: the user is willing to cook but mentally too tired to decide what. "Co jemy?" learns from a simple 👍/👎 signal and answers with a curated set of at most 4 recipe proposals — reducing choice instead of expanding it. The app never hosts recipe content; every proposal links out to an external source.

## North star

**S-02: New user requests proposals and gets 4 real, diverse recipes with working external links** — sequenced first among slices because it is the smallest flow that proves the product works at all, and because everything downstream (ratings, slot logic) is built on the proposal record it creates.

> Rationale revised 2026-07-18. The original argument was that S-02 "exercises the AI web-search retrieval that the developer has never used." The pivot to Spoonacular retires that reasoning — a plain REST call carries little learning risk. S-02 remains the correct north star on product grounds, but the genuine risk in Stream A has shifted from *retrieval feasibility* to *quota economics and content-display constraints*, which is what the retargeted F-01 now measures.

> "North star" here means: the smallest end-to-end user-visible flow whose successful delivery proves the product can work at all — placed as early as its prerequisites allow, because everything else only matters if this works.

## At a glance

| ID   | Change ID                   | Outcome (user can …)                                              | Prerequisites | PRD refs                              | Status   |
| ---- | --------------------------- | ----------------------------------------------------------------- | ------------- | ------------------------------------- | -------- |
| F-01 | spoonacular-retrieval-spike | (foundation) Spoonacular retrieval, quota, and terms verified in deployed Worker | —             | FR-003, FR-010, FR-011                 | done     |
| S-01 | production-auth-loop        | register, confirm email, and sign in on the production URL        | —             | FR-001, FR-002                         | done     |
| S-02 | cold-start-proposals        | request proposals and get 4 diverse real recipes with links       | F-01          | US-02, FR-003, FR-008, FR-010, FR-011, NFR (dead-link, mobile) | done |
| S-03 | rate-recipe                 | rate a proposed recipe 👍/👎; rating persists across sessions      | S-02          | FR-004                                 | done     |
| S-04 | manage-rated-recipes        | view rated recipes, change a rating, delete a rating              | S-03          | FR-005, FR-006, FR-007                 | done     |
| S-05 | personalized-proposal-slots | get proposals observably shaped by rating history (4-slot logic)  | S-02, S-03    | US-01, FR-008, FR-009                  | done |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                      | Chain                  | Note                                                                     |
| ------ | -------------------------- | ---------------------- | ------------------------------------------------------------------------ |
| A      | Proposal engine            | `F-01` → `S-02` → `S-05` | Carries the provider risk: quota economics and storage terms first, slot logic last. |
| B      | Production auth closure    | `S-01`                 | Standalone; finishes the already-deployed auth scaffold end-to-end.       |
| C      | Rating loop                | `S-03` → `S-04`        | Joins Stream A at `S-02`; ratings feed `S-05`'s personalization.          |

## Baseline

What's already in place in the codebase as of `2026-07-14` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 + React 19 + Tailwind 4; pages and auth components under `src/pages/` and `src/components/`
- **Backend / API:** partial — auth endpoints only (`src/pages/api/auth/`); no recipe/rating/proposal endpoints exist
- **Data:** partial — Supabase wired and live for auth (`src/lib/supabase.ts`), but no domain schema: `supabase/migrations/` does not exist; no ratings/recipes tables
- **Auth:** present — email/password via Supabase; middleware guards `/dashboard`; signin/signup/signout/confirm-email built and deployed
- **Deploy / infra:** present — live on Cloudflare Workers (`co-jemy.mediewilnp.workers.dev`); production secrets set; CI auto-deploy workflow drafted but not yet committed
- **Observability:** partial — Workers observability enabled + `wrangler tail`; no error tracking

## Foundations

### F-01: Spoonacular retrieval and quota spike

- **Outcome:** (foundation) a fetch-based Spoonacular `complexSearch` call is verified working in the deployed Worker and returns recipe candidates (title, description, `sourceUrl`, image); the point cost of one full proposal set is measured against the free plan's daily quota; and the provider's attribution and storage obligations are written down as concrete schema and UI constraints.
- **Change ID:** spoonacular-retrieval-spike
- **PRD refs:** FR-003, FR-010, FR-011
- **Unlocks:** S-02 (and transitively S-05); fixes the storable-field set and the per-session quota budget before S-02 writes a migration against them
- **Prerequisites:** —
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:**
  - What does one full 4-slot proposal set actually cost in points, and does the free plan's 50/day survive development testing plus real use? — Owner: user. Block: no (resolving this IS this foundation's work), but it is schema-determining.
  - Does an English-language, largely US-centric corpus serve a Polish-speaking user well enough day to day? US-02's "at least 2 cuisines" criterion will pass regardless, so it cannot detect this failure. — Owner: user. Block: no.
  - How often is `sourceUrl` dead, and does `spoonacularSourceUrl` work as a fallback? — Owner: team. Block: no.
- **Risk:** the retrieval-feasibility risk this item originally carried is gone — Spoonacular is a plain REST call with no `nodejs_compat` surface. What replaced it is heavier on the schema: the provider permits storing only recipe id, title, and image URL, and — because base cost is charged per call while cuisine diversity forces one call per pinned cuisine — the free quota caps the whole app at roughly 10–21 proposal sets per day. Both constrain what S-02 can build, so both must be measured before it starts.
- **Status:** done

> Retargeted 2026-07-18 (renamed from `ai-search-retrieval-spike`). See `context/changes/spoonacular-retrieval-spike/change.md` for the full rationale and the research already banked against these unknowns.

## Slices

### S-01: Production auth loop closed end-to-end

- **Outcome:** user can register, receive a confirmation email that lands on the production domain, sign in, reach the protected area, and sign out — all on the live URL.
- **Change ID:** production-auth-loop
- **PRD refs:** FR-001, FR-002
- **Prerequisites:** — (auth code is deployed; remaining work is external-service wiring and live verification, plus committing the drafted CI auto-deploy workflow)
- **Parallel with:** F-01, S-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** low-risk closure work, but until it lands no real user can complete registration in production — every later slice's live verification depends on working accounts.
- **Status:** done

### S-02: Cold-start proposals from the Spoonacular API *(north star)*

- **Outcome:** a logged-in user with no ratings can request proposals and see 4 real recipes from at least 2 different cuisines, each with a title, brief description, and working external link; a dead link is signaled instead of failing silently; proposed recipes are recorded so they can be rated later.
- **Change ID:** cold-start-proposals
- **PRD refs:** US-02, FR-003, FR-008 (cold-start behavior), FR-010, FR-011, NFR (dead-link, mobile)
- **Prerequisites:** F-01
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:**
  - ~~How much recipe metadata must be stored per proposal to support S-05's slot logic later without re-fetching?~~ **Promoted to a decision, 2026-07-18.** Under AI search, deferring this was reasonable — the metadata shape was unknowable until you saw what came back. Under Spoonacular the shape is documented *and* quota makes the answer load-bearing: if the requested cuisine and a seen-at timestamp are not captured at proposal time, S-05 must re-fetch every liked recipe to compute a taste profile, which the free tier will not sustain. Record the request-side facets the app itself chose (the requested `cuisine`, plus the requested meal `type` if one was sent) and a proposed-at timestamp, alongside `spoonacular_id`, from the first migration. Note the distinction that makes this legal: those are the app's own request and session data, so they sit *outside* FR-011's limit rather than inside it. Do **not** persist the response's `dishTypes[]` or `cuisines[]` — both are provider-returned recipe fields, and FR-011's restriction extends to derived and transformed copies.
- **Risk:** search latency and fabricated links are no longer the exposure here — a single REST call retires both. What this slice must now prove instead is that the quota budget and the three-field storage limit can actually carry a proposal card: title and image are storable, the description is not, so the card's description has to come from the live response. Keeping this slice free of rating logic still keeps the surface small.
- **Status:** done

### S-03: Rate a proposal

- **Outcome:** user can rate any proposed recipe 👍 or 👎, and the rating reliably persists across sessions (the PRD guardrail: losing rating history destroys the core value loop).
- **Change ID:** rate-recipe
- **PRD refs:** FR-004
- **Prerequisites:** S-02
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** introduces the ratings schema — the persistence guardrail lives here; kept small so correctness (per-user isolation, survives sessions) is easy to verify end-to-end.
- **Status:** done

### S-04: Manage rated recipes

- **Outcome:** user can view the list of their rated recipes, flip a rating (👍 ↔ 👎), and delete a rating to return the recipe to unrated status.
- **Change ID:** manage-rated-recipes
- **PRD refs:** FR-005, FR-006, FR-007
- **Prerequisites:** S-03
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** one coherent screen over data S-03 already persists; sequenced after S-03 because there is nothing to manage until ratings exist.
- **Status:** done

### S-05: Personalized 4-slot proposals

- **Outcome:** a user with rating history gets proposals observably shaped by it — slot 1: recently liked; slot 2: liked but not proposed in ≥2 weeks; slot 3: new recipe matching the inferred taste profile; slot 4: random discovery — with 👎-rated recipes permanently excluded and slot logic activating progressively as ratings accumulate.
- **Change ID:** personalized-proposal-slots
- **PRD refs:** US-01, FR-008, FR-009
- **Prerequisites:** S-02, S-03
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:**
  - What rating-history threshold activates each slot's logic (PRD says "sufficient rating history" without a number)? — Owner: user. Block: no (a default can ship and be tuned).
- **Risk:** this is the product's core hypothesis — that proposals shaped by rating history beat generic search; it lands last in the stream because it needs proposals (S-02) and ratings (S-03) to exist, and its slot rules must stay CPU-light on the Workers free tier.
- **Pivot note (2026-07-18):** the Spoonacular move makes this slice *easier*, not harder. FR-009's permanent 👎-exclusion and slot 2's "not proposed in ≥2 weeks" both become trivially reliable against a stable integer recipe id — under AI search, candidates had no stable identity, so exclusion would have been fuzzy title-matching. Slot 3's "inferred taste profile" likewise turns from a free-text prompt into structured `cuisine` / `diet` / `dishType` filters, which is both cheaper to compute and easier to explain. The constraint to respect: the profile must be inferred from cuisines the app *requested and recorded*, not from the response's `cuisines[]` array, which is a derived field and often empty.
- **Status:** done

## Backlog Handoff

| Roadmap ID | Change ID                   | Issue                                                          | Suggested issue title                                    | Ready for `/10x-plan` | Notes                              |
| ---------- | --------------------------- | ------------------------------------------------------------- | -------------------------------------------------------- | --------------------- | ---------------------------------- |
| F-01       | spoonacular-retrieval-spike | [#1](https://github.com/KSchlagowski/Co_jemy/issues/1)        | Verify Spoonacular retrieval, quota, and terms in the deployed Worker | yes                   | Run `/10x-plan spoonacular-retrieval-spike`. Issue #1's title still says "AI web-search" — retitle it on GitHub. |
| S-01       | production-auth-loop        | [#2](https://github.com/KSchlagowski/Co_jemy/issues/2)        | Close the production auth loop end-to-end                | yes                   | Run `/10x-plan production-auth-loop` |
| S-02       | cold-start-proposals        | [#3](https://github.com/KSchlagowski/Co_jemy/issues/3)        | Cold-start recipe proposals from the Spoonacular API     | no                    | After F-01. Retitle issue #3 too.  |
| S-03       | rate-recipe                 | [#4](https://github.com/KSchlagowski/Co_jemy/issues/4)        | Rate a proposed recipe with persistent 👍/👎              | no                    | After S-02                         |
| S-04       | manage-rated-recipes        | [#5](https://github.com/KSchlagowski/Co_jemy/issues/5)        | View, change, and delete recipe ratings                  | no                    | After S-03                         |
| S-05       | personalized-proposal-slots | [#6](https://github.com/KSchlagowski/Co_jemy/issues/6)        | Personalized 4-slot proposal logic                       | no                    | After S-02 + S-03                  |

## Open Roadmap Questions

1. **The PRD's hard deadline (2026-07-05) has passed — should the PRD's timeline framing be updated, or is the project now open-ended after-hours work?** — Owner: user. Block: none (informational; does not gate any slice, but affects how aggressively Parked items stay parked).

## Parked

- **No own recipe content** — Why parked: PRD §Non-Goals; external links only, avoids copyright and ingestion scope.
- **No shopping list generation** — Why parked: PRD §Non-Goals; explicit scope boundary.
- **No macro or nutritional data** — Why parked: PRD §Non-Goals; avoids health-claim and data complexity.
- **No native mobile app** — Why parked: PRD §Non-Goals; mobile-responsive web covers phone use.
- **No advanced recommendation algorithm** — Why parked: PRD §Non-Goals; v1 is 4 hand-coded slot rules, not ML.
- **No recipe import** — Why parked: PRD §Non-Goals; users cannot add recipes to the pool.
- **No portion scaling or recalculation** — Why parked: PRD §Non-Goals; recipes shown as-is from sources.
- **No multi-user / shared profiles** — Why parked: PRD §Non-Goals; individual accounts only.

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches the item is archived.)

- **F-01: (foundation) a fetch-based Spoonacular `complexSearch` call is verified working in the deployed Worker and returns recipe candidates (title, description, `sourceUrl`, image); the point cost of one full proposal set is measured against the free plan's daily quota; and the provider's attribution and storage obligations are written down as concrete schema and UI constraints.** — Archived 2026-07-19 → `context/archive/2026-07-16-spoonacular-retrieval-spike/`. Lesson: —.
- **S-04: user can view the list of their rated recipes, flip a rating (👍 ↔ 👎), and delete a rating to return the recipe to unrated status.** — Archived 2026-08-09 → `context/archive/2026-08-09-manage-rated-recipes/`. Lesson: —.
- **S-01: register, confirm email, and sign in on the production URL** — Archived 2026-08-08 → `context/archive/2026-07-19-production-auth-loop/`. Lesson: —.
- **S-03: user can rate any proposed recipe 👍 or 👎, and the rating reliably persists across sessions (the PRD guardrail: losing rating history destroys the core value loop).** — Archived 2026-08-08 → `context/archive/2026-08-08-rate-recipe/`. Lesson: —.
- **S-02: a logged-in user with no ratings can request proposals and see 4 real recipes from at least 2 different cuisines, each with a title, brief description, and working external link; a dead link is signaled instead of failing silently; proposed recipes are recorded so they can be rated later.** — Archived 2026-08-08 → `context/archive/2026-07-20-cold-start-proposals/`. Lesson: —.
- **S-05: a user with rating history gets proposals observably shaped by it — slot 1: recently liked; slot 2: liked but not proposed in ≥2 weeks; slot 3: new recipe matching the inferred taste profile; slot 4: random discovery — with 👎-rated recipes permanently excluded and slot logic activating progressively as ratings accumulate.** — Archived 2026-08-09 → `context/archive/2026-08-08-personalized-proposal-slots/`. Lesson: —.
