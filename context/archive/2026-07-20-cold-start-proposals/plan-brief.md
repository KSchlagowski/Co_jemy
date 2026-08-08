# Cold-start Proposals — Plan Brief

> Full plan: `context/changes/cold-start-proposals/plan.md`
> Research: `context/changes/cold-start-proposals/research.md`

## What & Why

Roadmap slice **S-02**, the product's north star: a logged-in user with no rating history clicks "Get proposals" and gets 4 real recipes from 2 different cuisines — each with a title, a short excerpt, the publisher's credit, and a working external link. Without this, there is nothing to rate, and the feedback loop that the whole app exists for cannot start.

## Starting Point

The Spoonacular client (`src/lib/spoonacular.ts`) is production-hardened but has zero live callers — S-02 is its first consumer. Everything else is net-new: no database schema exists at all (no `supabase/migrations/` directory), `/api/**` is unguarded by middleware, no JSON error convention exists, and every form in the codebase is a native POST+redirect, so there is no client-side fetch→render pattern to copy.

## Desired End State

Signed in on the dashboard, a user clicks one button and sees a grid of 4 recipe cards spanning two cuisines. Links open the publisher's page; missing images degrade to a placeholder; a failure says something true and specific ("out of budget until tomorrow" vs "the recipe service is down") rather than a futile "try again". Behind the scenes each set has written 4 rows the ratings slice can attach to.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Storable fields | `spoonacular_id`, `title`, `image` only | Provider terms permit exactly these three indefinitely; everything else is prohibited even in derived form. | Research |
| Cuisines per set | 2, not 4 | Calls dominate cost (1 pt each), so 2 cuisines is 2.71 pts / ~18 sets/day vs 5.40 / ~9. | Research |
| Table split | Two tables — `recipes` + `proposals` | A forced purge of provider data leaves the user's event history intact, satisfying the PRD guardrail structurally rather than by convention. | Plan |
| Database auth | RLS on the user's session | No new secret, no service-role client; the policy *is* the access control instead of trusted app code. | Plan |
| `recipes` policies | Open to `authenticated` | It's a shared catalogue with no user data — restricting it would break the upsert without protecting anything. | Plan |
| Quota gating | Graceful 402 only, no gate | Meets the binding rule with zero new infra; ~18 sets/day of single-user traffic hasn't produced the problem a KV counter would solve. | Plan |
| Cuisine rotation | Random pair + random offset | Stateless — no column, no read-before-write — and two randomness axes make repeat sets feel genuinely different. | Plan |
| Payload validation | Drop invalid results, keep the rest | One malformed row in an over-fetched batch of 20 can't break a set; matches the repo's manual `typeof` guard convention. | Plan |
| Error UX | Distinct message per reason | "Quota spent" and "provider down" call for different user action; establishes the repo's first JSON error envelope. | Plan |
| UI location | In place on the dashboard | Fewest files, and `/dashboard` is already a protected route, so no middleware or nav work. | Plan |
| First cut if time is short | Skeleton loading state | Purely cosmetic; zero impact on the slice's stated outcome. | Plan |

## Scope

**In scope:** First Supabase migration (2 tables + RLS) · `toCandidate` validation (F5 precondition) · cuisine constants and pair picker · HTML summary → plain-text excerpt sanitizer · proposal set assembly · `POST /api/proposals` with session guard and JSON envelope · dashboard React island with cards, image fallback, and per-reason error banners · production deploy and live verification.

**Out of scope:** Ratings (S-03) · the 4-slot classification logic (activates with rating history) · runtime quota gate / KV counter · active link reachability checks · a dedicated `/proposals` page · service-role client · meal-type parameter · test suite · any caching of provider data.

## Architecture / Approach

Four layers built bottom-up, each verifiable by lint + build.

```
[ Migration ]  recipes (shared ref) ←FK— proposals (per-user event, RLS)
      ↓
[ Retrieval ]  pickCuisinePair() → 2 concurrent searchRecipes calls (number=20,
               sort=random, random offset) → validate → dedupe → interleave → 4
      ↓
[ Endpoint  ]  POST /api/proposals — 401 guard first (before any quota spend),
               persist, map typed failure union → 402/502/503 + machine reason
      ↓
[ UI        ]  ProposalList island on /dashboard → RecipeCard grid + ProposalError
```

The retrieval layer is a pure boundary above the existing client. Persistence rides the user's cookie session under RLS — which is what lets the slice ship with no new secret.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data layer | First migration: 2 tables, RLS policies | RLS policies wrong in a way that only shows at runtime; prod schema changes are human-only |
| 2. Retrieval layer | Validation, cuisine picker, sanitizer, set assembly | Sanitizer leaks a macro figure or backlink — a non-goal/licence breach, not a cosmetic bug |
| 3. Endpoint | `POST /api/proposals` + persistence + JSON envelope | Auth guard placed after the provider call would let anonymous requests burn quota |
| 4. Dashboard UI | Island, cards, image fallback, error banners | First react-compiler-constrained fetch flow in the repo; double-submit burns quota |
| 5. Deploy & verify | Live on production, verified checklist | Depends on a working prod account; Supabase SMTP is rate-limited |

**Prerequisites:** F-01 spike (done, archived) · Supabase project linked for `db push` · `SPOONACULAR_API_KEY` already set as a Worker secret · a working production account for live verification (S-01's own verification 3.3–3.5 is still open).
**Estimated effort:** ~3–4 sessions across 5 phases; phase 1 and 4 are the largest.

## Open Risks & Assumptions

- **S-01 is not fully closed.** Its live verification (3.3–3.5) is still unchecked, and S-02's phase 5 depends on a working production account. Supabase's built-in SMTP is rate-limited to a few emails/hour, so budget signups with plus-addressing.
- **Silent validation drops.** Dropping malformed results means a wholesale provider schema change would quietly shrink sets rather than raise an alarm. Right trade now; worth a lesson entry if it bites.
- **Dev and real use share one 50-point budget.** A single afternoon of iteration can exhaust the day's quota — hence the ≤25 pts/day dev cap as human discipline. This is PRD Open Question 1 and remains unresolved by design.
- **Corpus fit is untested for a Polish-speaking user** (PRD Open Question 2). The "≥2 cuisines" criterion will pass on a corpus that is nonetheless a poor everyday fit; this slice cannot detect that failure.
- **Link liveness posture rests on a 98% sample** that skewed toward one publisher — posture-setting, not a guarantee.

## Success Criteria (Summary)

- A signed-in user on production clicks once and sees 4 recipes from 2 cuisines, each with a publisher credit and a link that resolves to a live external page.
- Those 4 proposals are durably recorded with the cuisine the app requested, so the ratings slice has something to attach to.
- A failure — quota spent, provider down, misconfigured — produces a message that tells the user something true, and the measured cost of a set is ≈2.71 points with no extra calls leaked in.
