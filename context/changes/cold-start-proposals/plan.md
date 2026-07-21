# Cold-start Proposals Implementation Plan

## Overview

Deliver roadmap slice **S-02**: a logged-in user with no rating history clicks "Get proposals" on the dashboard and sees 4 real recipes drawn from 2 different cuisines, each with a title, a short plain-text excerpt, the publisher's name, and a working external link. Every proposed recipe is recorded so S-03 (ratings) can attach to it.

This is the first slice that touches persistence, so it carries the repo's first Supabase migration, its first session-authenticated JSON API endpoint, and its first client-side fetch→render flow.

## Current State Analysis

The Spoonacular client (`src/lib/spoonacular.ts`) is production-hardened and has **zero live callers** — S-02 is its first consumer. Everything else the slice needs is net-new:

- **No database schema exists.** `supabase/` has `config.toml` (migrations enabled, Postgres 17) but no `migrations/` directory, no `.sql` files, no RLS policies, no generated DB types. The `supabase` CLI is installed as a devDependency (`^2.109.0`).
- **`/api/**` is unguarded.** `src/middleware.ts:4` protects only `/dashboard`; it populates `context.locals.user` on every request but no endpoint reads it yet. A proposals endpoint must self-guard and return 401 rather than redirect.
- **No JSON error convention exists.** Auth endpoints return plain-text bodies or redirect with `?error=`. `src/pages/api/auth/callback.ts:14-43` is the only endpoint parsing JSON and returning real `Response` objects — it is the structural template.
- **No client-side fetch pattern exists.** Every form is a native HTML POST (`SignInForm.tsx:43`) with `useFormStatus` for pending state — which only works with native form submission and is therefore unusable here.
- **Anon key only.** `src/lib/supabase.ts:5` exposes a single `createClient(headers, cookies)` factory; there is no service-role client or env var.
- **No tests anywhere.** Verification is `npm run lint` + `npm run astro sync && npm run build` + a manual live checklist.

The quota economics are measured and binding: 1 point per call + 0.035 per recipe returned, so **calls dominate cost**. At this slice's shape — 2 calls at `number=20` — a cold-start set costs 2 + 40×0.035 = **3.40 points** (~14 sets/day on the free plan). The spike's measured 2.71 figure (and the 2.71 rows in `docs/reference/contract-surfaces.md` and `plan-brief.md`) describe the same 2 calls at `number=10`; the extra 0.70 is the deliberate over-fetch. A 4-cuisine set would cost 4 + 80×0.035 = 6.80 (~7/day) — which is why the pair is the ceiling.

## Desired End State

A signed-in user on `/dashboard` sees a "Get proposals" button. Clicking it fetches a set and renders 4 cards. Each card shows the recipe title, a short plain-text excerpt with no markup and no calorie figures, the publisher name, and a link that opens the publisher's page in a new tab. A missing or rotted image degrades to a placeholder rather than a broken thumbnail. When the set cannot be delivered, the user sees a message specific to the reason — quota spent, provider unreachable, or service misconfigured — never a generic "try again" that is futile.

Behind it, each proposal set has written one row per recipe into `proposals` (scoped to the user by RLS) and upserted the three storable provider fields into `recipes`.

**Verification**: sign in on production, click the button, confirm 4 cards spanning 2 cuisines with working links, then query Supabase and confirm 4 `proposals` rows carrying the two requested cuisine values.

### Key Discoveries:

- `RecipeCandidate` (`src/lib/spoonacular.ts:6-14`) is already exactly the proposal-card shape — `id`, `title`, `image`, `summary`, `sourceName`, `sourceUrl`, `spoonacularSourceUrl`. No adapter type is needed between the client and the UI.
- `SpoonacularResult` (`:23-30`) is a discriminated union with typed failure reasons. The deleted spike endpoint's status mapping is a proven precedent: ok→200, `quota_exhausted`→402, `not_configured`→503, else→502.
- `toCandidate` (`:51-61`) blind-casts `raw.id as number` with no validation — flagged as an explicit S-02 precondition (F5) in the spike's review triage. It must be hardened before proposal logic consumes it.
- `searchRecipes` (`:110-122`) already clamps `offset` to 0–900 and hardcodes `addRecipeInformation=true`; it has **no `type` param**.
- `astro/no-set-html-directive` is an ESLint **error** (`eslint.config.js:65`) — the HTML `summary` must be stripped server-side, never injected.
- `react-compiler/react-compiler` is an ESLint **error** (`eslint.config.js:58`; the plugin is registered at `:52`) — the new island must be compiler-clean.
- Supabase RLS convention (confirmed against current docs): `grant` the operations to `authenticated`, then one policy per operation, wrapping the auth call as `(select auth.uid())` so the planner hoists it out of the row loop.
- `wrangler rollback` reverts Worker code only, not Supabase schema — migrations must stay backward-compatible across a rollback.

## What We're NOT Doing

- **No ratings.** 👍/👎 capture, storage, and the rating list are S-03. This slice only makes recipes *rateable* by recording them.
- **No slot logic.** FR-008's four-slot classification (recently liked / forgotten favorite / taste-matched / outlier) activates once rating history exists. Cold start fills all 4 slots from random cuisine draws, which is the PRD-specified behavior for a user with no ratings.
- **No runtime quota gate.** No KV binding, no point counter, no request refusal. The typed 402 is surfaced gracefully and that is the whole quota story for S-02. Dev-side discipline (≤25 points/day) stays a human rule.
- **No active link reachability check.** Measured 98% `sourceUrl` liveness makes a pre-flight HEAD request a poor trade; the fallback chain plus a graceful error state is the agreed posture.
- **No `/proposals` page.** The island mounts in place on the dashboard.
- **No service-role Supabase client**, no new env var, no `type` (meal type) parameter — cold start pins cuisine only, so `requested_type` is written as NULL and the column exists purely so S-05 need not migrate.
- **No test suite.** No runner exists; it arrives with Module 3.
- **No caching of provider data.** Prohibited by FR-011 without prior written permission.

## Implementation Approach

Build bottom-up in four layers, each independently verifiable by lint + build, then ship and verify live.

The retrieval layer is a pure function boundary: given a cuisine pair, it issues exactly two `searchRecipes` calls with `number=20` and random offsets, validates and dedupes the merged results, and interleaves them so the two cuisines alternate in the rendered order. Over-fetching 20 per call brings the set to 3.40 points against a 2.00-point call floor — 1.40 of over-fetch across both calls — and that surplus is what guarantees 4 survivors after validation drops and dedup. Cheap next to a third call, which would cost a full point on its own.

The endpoint composes that layer with persistence and maps the typed failure union onto HTTP statuses plus a machine-readable `reason` code. The UI consumes that envelope and branches its error banner on the code.

Persistence rides the user's existing cookie session under RLS. `proposals` is user-owned (`auth.uid() = user_id`); `recipes` is a shared catalogue with no user data, so it grants `authenticated` unrestricted select and insert. This is what lets the slice ship without a service-role key.

## Critical Implementation Details

**State sequencing — persist before responding, but never fail the set on a write error.** The user's proposals are worthless if unrecorded (S-03 has nothing to attach to), but a Postgres hiccup after a quota point is already spent should not throw away recipes the user could still act on. Write first, and if the write fails, still return the recipes with a flag indicating they were not recorded — the quota point is non-refundable, the database row is retryable.

**Upsert ordering.** `recipes` rows must land before `proposals` rows — the FK points that way. Use a single `upsert` on `recipes` with `onConflict: "spoonacular_id"` and `ignoreDuplicates: true`, since re-proposing a known recipe is the normal case, not an error.

**Excerpt sanitization is a licence surface, not a formatting nicety.** Spoonacular's `summary` embeds `<b>` tags, `<a>` backlinks to spoonacular.com, and — routinely — inline calorie and macro figures. Stripping tags is necessary but not sufficient: the no-macros non-goal means numeric nutrition claims must be dropped from the excerpt too. Truncate at a sentence boundary before any such figure rather than mid-word.

## Phase 1: Data Layer — First Migration

### Overview

Create `supabase/migrations/` and the repo's first migration: two tables with RLS enabled and `authenticated`-scoped policies. Nothing consumes them yet; this phase is proven by the migration applying cleanly.

### Changes Required:

#### 1. First migration file

**File**: `supabase/migrations/<timestamp>_cold_start_proposals.sql` (generated by `npx supabase migration new cold_start_proposals`)

**Intent**: Establish the persistence shape the whole rating loop builds on, split so that a forced purge of provider-derived data leaves the user's own event history intact (PRD §Guardrails).

**Contract**: Two tables.

`recipes` — the shared provider-derived reference, holding **exactly** the three fields the provider's terms permit storing indefinitely:
- `spoonacular_id` bigint primary key
- `title` text not null
- `image` text null
- `created_at` timestamptz not null default `now()`

`proposals` — the per-user event record, all app-owned data:
- `id` bigint generated by default as identity primary key
- `user_id` uuid not null references `auth.users`
- `spoonacular_id` bigint not null references `recipes(spoonacular_id)`
- `requested_cuisine` text not null — the cuisine *the app pinned in its request*, never the response's `cuisines[]`
- `requested_type` text null — reserved for S-05; always NULL in this slice
- `proposed_at` timestamptz not null default `now()`

Index `proposals(user_id, proposed_at desc)` — the access path for S-03's history view and S-05's slot-2 "not seen in ≥2 weeks" rule.

**Prohibited columns** (FR-011, including derived or transformed copies): `summary`, `cuisines`, `dish_types`, ingredients, instructions, nutrition. A reviewer should be able to read this migration and see that only the three permitted provider fields are present.

#### 2. RLS policies in the same migration

**File**: same migration file

**Intent**: Make the database the access-control boundary rather than trusting app code, since the endpoint writes with the anon key on the user's session.

**Contract**: `alter table ... enable row level security` on both tables, then:

- `proposals` — `grant select, insert on proposals to authenticated`, plus a select policy `using ((select auth.uid()) = user_id)` and an insert policy `with check ((select auth.uid()) = user_id)`. No update or delete policy in this slice; S-03 adds what it needs.
- `recipes` — `grant select, insert on recipes to authenticated`, plus a select policy `using (true)` and an insert policy `with check (true)`. This table is a shared catalogue containing no user data; restricting it would break the upsert without protecting anything.

Wrap the auth call as `(select auth.uid())`, not bare `auth.uid()` — the subquery form lets the planner evaluate it once instead of per row.

Grant the identity sequence on `proposals` to `authenticated` if the insert requires it.

### Success Criteria:

#### Automated Verification:

- Migration file exists under `supabase/migrations/`
- Linting passes: `npm run lint`

#### Manual Verification:

- **(human-run)** Dry run reports the expected changes: `npx supabase db push --dry-run --linked`
- **(human-run)** Migration applies to the linked project: `npx supabase db push --linked`
- Both tables visible in the Supabase dashboard with RLS shown as enabled
- Inserting a `proposals` row with a mismatched `user_id` is rejected by the policy
- Selecting `proposals` as one user returns no rows belonging to another user

**Implementation Note**: Production schema changes are a human-only boundary per `context/changes/deployment/deployment-plan.md` — the agent authors the migration and stops there; both `db push` steps are human-run and therefore sit under Manual Verification, not Automated. The linked project *is* production; there is no staging project. Pause here for manual confirmation before proceeding.

---

## Phase 2: Retrieval Layer

### Overview

Harden the provider boundary and build the pure logic that turns two API calls into a rendered-ready set of 4. No I/O beyond the existing client; no persistence; no HTTP.

### Changes Required:

#### 1. Validate the provider payload narrowing

**File**: `src/lib/spoonacular.ts`

**Intent**: Close the F5 precondition. `toCandidate` currently asserts types it has not checked, so a provider schema drift or a partial result would flow a malformed object into proposal logic and the database.

**Contract**: `toCandidate` returns `RecipeCandidate | null` — null when `id` is not a finite number or `title` is not a non-empty string. Remaining fields keep today's nullable coercion. Both `extract` callbacks filter nulls out, so `searchRecipes` returns only valid candidates and a single malformed result in a batch of 20 cannot break a set. Follow the codebase's manual `typeof` guard convention (`callback.ts:29,34`) — do not introduce a validation library.

Note the tradeoff being accepted: drops are silent. A wholesale provider contract change would shrink sets rather than raise an alarm. That is the right trade at this stage but worth a lesson entry if it ever bites.

#### 2. Cuisine constants and pair selection

**File**: `src/lib/proposals.ts` (new)

**Intent**: Give the app a vetted cuisine vocabulary and a stateless way to vary which two it asks for, so successive sets feel different without a stored rotation counter.

**Contract**: A frozen `CUISINES` constant of the six values the spike verified return full results: `italian`, `mexican`, `chinese`, `greek`, `thai`, `french`. A `pickCuisinePair()` returning two *distinct* entries at random. Randomness has two axes — the pair and a per-call `offset` — so repeat sets vary even when a pair recurs.

The offset is drawn from **0–20**, not the provider's 0–900 clamp. That 900 is `searchRecipes`' upper bound, not evidence of corpus depth. **Measured 2026-07-20** (the dev call this plan called for): at offset 50, `chinese`, `greek`, and `thai` return zero results, while `italian`, `mexican`, and `french` return normally; all six return results at offset 20. An offset past a cuisine's corpus returns zero results while still costing its 1-point base — observed live as two consecutive single-cuisine sets. 20 is therefore the bound, and `sort=random` carries most of the variety.

#### 3. Summary sanitization

**File**: `src/lib/proposals.ts`

**Intent**: Turn the provider's HTML `summary` into a short plain-text excerpt that satisfies both the no-raw-HTML lint rule and the no-macros non-goal.

**Contract**: A function taking `string | null` and returning a short plain-text excerpt (roughly 160 chars, cut at a sentence or word boundary — never mid-word) or null. It strips all markup including the provider's `<a>` backlinks, decodes common HTML entities, collapses whitespace, and truncates *before* any calorie/macro figure rather than carrying one into the excerpt.

Three refinements the live payloads forced (2026-07-20):

- The cut set is wider than bare macro figures. Anchor *text* survives tag stripping, so provider mentions cut too; and Spoonacular phrases nutrition claims without a figure — `covers 12% of your daily requirements`, `Watching your figure?` — which lead into macro talk regardless.
- Sentence-boundary detection must require a following space or end-of-string. A bare `lastIndexOf(".")` reads the decimal in `$4.62 per serving` as a sentence end and truncates the excerpt to `For $4.`.
- When no sentence boundary precedes the cut, trailing function words are trimmed and a remainder under 40 chars returns **null**. A stub like `This recipe serves 4 and has…` reads as a bug, not an excerpt.

This is the one place a snippet is warranted, because the macro-trimming requirement is easy to read past — the sanitizer must recognize nutrition phrasing, not just tags:

```ts
// Spoonacular summaries routinely read: "...has 452 calories, 23g of protein..."
// Cutting at the first such figure keeps the no-macros non-goal intact (PRD Non-Goals).
const NUTRITION_FIGURE = /\b\d+\s*(k?cal|calories|g\s+of\s+(protein|fat|carbo?hydrates?)|grams?\s+of)/i;
```

#### 4. Proposal set assembly

**File**: `src/lib/proposals.ts`

**Intent**: Compose the two cuisine-pinned calls into one ordered set of 4, keeping the request-side cuisine attached to each candidate — because the response's `cuisines[]` is derived, often empty, and must never be persisted.

**Contract**: An async `buildColdStartSet()` returning a discriminated union mirroring `SpoonacularResult`'s style: either `{ ok: true; proposals: ProposedRecipe[]; degraded: boolean }` or `{ ok: false; reason; status }`, where `ProposedRecipe` is `RecipeCandidate & { requestedCuisine: string; excerpt: string | null }`.

Behavior:
- Issue exactly **two** `searchRecipes` calls, one per picked cuisine, each with `number: 20`, `sort: "random"`, and an independent random `offset` in 0–50. Two calls is the floor and the ceiling — never one call per slot.
- Run the calls concurrently (`Promise.all`); they are independent and latency is user-facing.
- If **both** calls fail, propagate the first failure reason. If **one** fails, continue with the survivor — 4 cards from a single cuisine beats an error screen, even though it misses the 2-cuisine target. Set `degraded: true` on the success result so the endpoint and UI can note it.
- `degraded` reports **cuisine coverage of the assembled set** (`< 2` distinct cuisines), not call failure. A call can return HTTP 200 with an empty array — a thin cuisine, or an offset past its corpus — which produces a single-cuisine set from two healthy calls. Keying the flag to call failure read `false` on exactly that case, which is the US-02 violation the flag exists to surface.
- Dedupe the merged results by recipe id; the same recipe can legitimately return under two cuisines.
- Interleave by cuisine (A, B, A, B) and take **up to** 4, so diversity is visible in the rendered order rather than buried. Return whatever survives — 0 to 4 — rather than padding or failing: the PRD specifies "up to 4", and a thin, heavily overlapping, or validation-drained result is a legitimate small set, not an error. When the cuisines are unbalanced, interleave best-effort and let the longer side finish the tail.
- Attach the requested cuisine and the sanitized excerpt to each survivor.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run astro sync && npm run build`
- Linting passes, including the react-compiler rule: `npm run lint`

#### Manual Verification:

- Sanitizer output on a real `summary` contains no angle brackets, no spoonacular.com text, and no calorie or macro figures
- A set assembled against the live API returns 4 distinct recipes spanning both requested cuisines
- Repeated calls return visibly different recipes (random pair + random offset both varying)

---

## Phase 3: Proposals Endpoint

### Overview

The first session-authenticated JSON endpoint in the repo, and the first to read `context.locals.user`. Composes retrieval with persistence and defines the JSON envelope later endpoints will inherit.

### Changes Required:

#### 1. The endpoint

**File**: `src/pages/api/proposals.ts` (new)

**Intent**: Give the dashboard island a single call that returns a rendered-ready proposal set and durably records it.

**Contract**: `export const POST: APIRoute = async (context) => {...}`, following the `callback.ts` shape (single `context` param, real `Response` objects, no `prerender` flag).

Ordering:
1. Read `context.locals.user`; if null return **401**. Middleware does not guard `/api/**`, so this check is the only thing standing between an anonymous request and a spent quota point — it comes before any provider call.
2. `createClient(context.request.headers, context.cookies)`; null → **503** `service_unavailable`.
3. `buildColdStartSet()`; on failure map the reason to a status (below).
4. Persist (see next change).
5. Return **200** with the set.

Response envelope — this is the convention later endpoints inherit:
- Success: `{ ok: true, proposals: [...], recorded: boolean, degraded: boolean }` — `degraded` passes through `buildColdStartSet`'s flag: true when only one cuisine call survived, so the set spans one cuisine rather than two
- Failure: `{ ok: false, reason: string }` where `reason` is the machine code the UI branches on

Status mapping, following the spike endpoint's proven precedent: `quota_exhausted`→**402**, `not_configured`→**503**, `http_error`/`network_error`→**502**, unauthenticated→**401**.

Never let a URL or message from the Spoonacular module reach the response body — the key travels as a query param and the module's whole discipline is that it never escapes. Return the typed reason, nothing else.

#### 2. Persistence

**File**: `src/pages/api/proposals.ts`

**Intent**: Record the set so S-03 can attach ratings, without letting a write failure discard recipes the user could still use.

**Contract**: Upsert all four recipes into `recipes` (`onConflict: "spoonacular_id"`, `ignoreDuplicates: true`) — re-proposing a known recipe is the normal path, not an error — then insert four `proposals` rows carrying `user_id`, `spoonacular_id`, `requested_cuisine`, and a null `requested_type`. Both writes ride the request's session client so RLS applies.

If either write fails, return **200** with the proposals and `recorded: false` rather than an error status. The quota point is already spent and non-refundable; the recipes are still useful; the database row is the retryable part.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run astro sync && npm run build`
- Linting passes: `npm run lint`

#### Manual Verification:

- `POST /api/proposals` without a session returns 401 and makes **no** provider call (verify the quota counter is unchanged)
- A signed-in POST returns 200 with 4 proposals across 2 cuisines
- `proposals` gains exactly 4 rows with the correct `user_id` and the two requested cuisine values; `requested_type` is null
- `recipes` gains rows only for previously unseen ids; a repeat proposal does not error
- No response body anywhere contains an API key, a URL, or a provider error string

---

## Phase 4: Dashboard UI

### Overview

Replace the dashboard's placeholder text with the proposals island — the repo's first client-side fetch→render flow.

### Changes Required:

#### 1. Proposals island

**File**: `src/components/proposals/ProposalList.tsx` (new)

**Intent**: Own the request lifecycle — idle, loading, loaded, error — and render the card grid.

**Contract**: A `client:load` React component with no props. Plain `useState` for status and data; `useFormStatus` does not apply here because there is no native form submission. The component must satisfy `react-compiler/react-compiler: "error"` — no conditional hooks, no manual memoization fighting the compiler.

Guard against double-submission while a request is in flight: each click that reaches the endpoint costs real quota.

Render however many proposals arrive rather than assuming 4 — the set is "up to 4". An `ok: true` response with an empty `proposals` array shows the provider-error banner ("we couldn't find recipes this time"), never a blank grid.

When the envelope carries `degraded: true`, render a quiet inline note above the grid ("only one cuisine was available this time") — informational, not an error state; the cards still render normally.

Loading state is a plain "Loading…" indicator. Shaped skeleton placeholders are the agreed first cut if time runs short.

#### 2. Recipe card

**File**: `src/components/proposals/RecipeCard.tsx` (new)

**Intent**: Render one proposal in a way that satisfies the attribution licence and degrades gracefully.

**Contract**: Takes one proposal. Renders title, excerpt, image, publisher credit, and link.

Licence-bound behavior (FR-010 — a breach, not a UI regression):
- Link target is `sourceUrl`; `spoonacularSourceUrl` is used **only** when `sourceUrl` is absent
- The `sourceName` credit is displayed **even when neither link is available**
- External links open in a new tab with `rel="noopener noreferrer"`

Image handling: `image` is nullable and URLs rot, so render a styled placeholder when null and swap to it via `onError` when loading fails.

The excerpt arrives already sanitized from the server as plain text — render it as text. `astro/no-set-html-directive` is an ESLint error and `dangerouslySetInnerHTML` is not an escape hatch here.

#### 3. Error banner

**File**: `src/components/proposals/ProposalError.tsx` (new)

**Intent**: Tell the user something true and actionable about why the set failed.

**Contract**: Takes the machine `reason` and maps it to a distinct message, following the inline-banner pattern at `ServerError.tsx:7-15` (returns null when there is no message). The mappings must differ meaningfully: quota exhausted means *come back tomorrow* (retrying today is futile), provider errors mean *try again shortly*, misconfiguration means *this is our problem, not yours*. No retry button — retrying a metered API on a button is how quota disappears.

#### 4. Dashboard integration

**File**: `src/pages/dashboard.astro`

**Intent**: Put the core loop on the page the user already lands on after signing in.

**Contract**: Replace the "This page is only for authenticated users" placeholder with `<ProposalList client:load />`. The page is already in `PROTECTED_ROUTES` (`src/middleware.ts:4`), so no middleware change is needed. Widen the glass card to hold a 4-card grid and follow the responsive grid pattern at `Welcome.astro:57`, which reads `mx-auto grid max-w-4xl grid-cols-1 gap-6 px-4 pb-24 sm:grid-cols-3` — adapt it to `sm:grid-cols-2` here, since 4 cards divide evenly into two columns where three would leave a ragged row. Keep the existing `bg-cosmic` shell and glassmorphism palette. Sign-out stays.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run astro sync && npm run build`
- Linting passes, including react-compiler and `astro/no-set-html-directive`: `npm run lint`

#### Manual Verification:

- Clicking "Get proposals" renders 4 cards; rapid double-clicks do not fire two requests
- Every card shows a publisher name and a link that opens the publisher's page in a new tab
- Cards render legibly at 375px width (mobile NFR) and in the 2-column layout above `sm`
- A card with a null or broken image shows the placeholder, not a broken thumbnail
- No excerpt contains markup, a spoonacular.com mention, or a calorie figure
- Forcing a 402 (or stubbing the reason) shows the quota-specific message, not a generic retry prompt

---

## Phase 5: Deploy & Live Verification

### Overview

Ship to production and verify the loop against the live Worker, live Supabase, and the real quota.

### Changes Required:

#### 1. Merge and deploy

**File**: n/a — CI pipeline

**Intent**: Land the slice on production through the proven path.

**Contract**: Push to `master` triggers `.github/workflows/deploy.yml` (lint + build + `wrangler-action@v3`, concurrency-serialized). `SPOONACULAR_API_KEY` is already set as a Worker secret, so no secret work precedes this merge. The production migration must already be applied — schema before code, since `wrangler rollback` reverts code but not schema.

#### 2. Live checklist

**File**: `context/changes/cold-start-proposals/verification.md` (new)

**Intent**: Record what was actually checked against production, matching the S-01 convention.

**Contract**: A dated checklist capturing: the account used, the observed cards and their cuisines, one link followed through to a live publisher page, the `proposals` row count and cuisine values queried from Supabase, and the quota points consumed (from `X-API-Quota-Used`) measured against the predicted 3.40.

### Success Criteria:

#### Automated Verification:

- CI run is green on the merge commit
- Production responds: `curl -s -o /dev/null -w "%{http_code}" https://co-jemy.mediewilnp.workers.dev/`

#### Manual Verification:

- Signed in on production, "Get proposals" returns 4 cards spanning 2 cuisines
- At least one card's publisher link resolves to a live external recipe page
- Supabase shows 4 new `proposals` rows for that user with the two requested cuisines
- Measured quota cost for the set is ≈3.40 points (2 calls × `number=20`), confirming no extra calls leaked in
- The dashboard is usable on a real phone browser

**Implementation Note**: S-01's live verification (plan progress 3.3–3.5) is still open and S-02's verification depends on a working production account. Supabase's built-in SMTP is rate-limited to a few emails per hour, so budget signups and use plus-addressing.

---

## Testing Strategy

No test runner exists in this project (it arrives with Module 3), so verification is lint + build + manual checklist. The manual steps below are the substitute for automated coverage and should be run in order.

### Manual Testing Steps:

1. Apply the migration to a local or staging Supabase project; confirm both tables and RLS enabled.
2. Attempt a cross-user `proposals` insert; confirm the policy rejects it.
3. `POST /api/proposals` with no session; confirm 401 and an unchanged quota counter.
4. Sign in, request a set; confirm 4 cards, 2 cuisines, 4 database rows.
5. Request a second set; confirm different recipes and that repeat `recipes` ids do not error.
6. Inspect excerpts for markup, backlinks, and calorie figures.
7. Follow every card's link; confirm each resolves or falls back as designed.
8. Exhaust or stub the quota; confirm the 402-specific message appears with no retry affordance.
9. Load the dashboard at 375px width; confirm the layout holds.

### Edge Cases To Exercise Explicitly:

- Both provider calls fail → single propagated error, not a half-rendered grid
- One provider call fails → 4 cards from the surviving cuisine, degradation signaled
- A malformed result in a batch → dropped silently, set still reaches 4
- The same recipe returned under both cuisines → deduped, set still reaches 4
- Fewer than 4 survivors after drops and dedup → the smaller set renders as-is; an empty one shows the error banner, not a blank grid
- Database write fails after a successful fetch → 200 with `recorded: false`, recipes still shown

## Performance Considerations

The two provider calls run concurrently, so user-facing latency is one round trip, not two. Over-fetching `number=20` per call brings the set to 3.40 points against a 2.00-point call floor (1.40 of over-fetch across both calls) — a deliberate trade, since call count dominates cost and the surplus is what guarantees 4 survivors after validation drops and dedup. The `proposals(user_id, proposed_at desc)` index is laid down now because S-03 and S-05 both read along it.

## Migration Notes

This is the repo's first migration, so `supabase/migrations/` is created here. Both tables are additive — nothing existing is altered — so the migration is safe across a `wrangler rollback`, which reverts Worker code but leaves schema in place. Rolling back to a pre-S-02 Worker with the tables present is harmless; the reverse (code without schema) is not, which is why the migration is applied before the merge. Altering or dropping production tables is a human-only action.

## References

- Internal research: `context/changes/cold-start-proposals/research.md`
- Change brief: `context/changes/cold-start-proposals/change.md`
- Binding constraints registry: `docs/reference/contract-surfaces.md`
- Spike findings (measured costs, request-shaping rules, link liveness): `context/archive/2026-07-16-spoonacular-retrieval-spike/findings.md`
- F5 precondition: `context/changes/spoonacular-retrieval-spike/follow-ups/review-fixes.md`
- Plan structure and deploy/CI/verification conventions: `context/changes/production-auth-loop/plan.md`
- Production-access boundary: `context/changes/deployment/deployment-plan.md`
- Endpoint template: `src/pages/api/auth/callback.ts:14-43`
- Card grid pattern: `src/components/Welcome.astro:57`
- Error banner pattern: `src/components/auth/ServerError.tsx:7-15`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data Layer — First Migration

#### Automated

- [x] 1.1 Migration file exists under `supabase/migrations/` — 1a6390e
- [x] 1.2 Linting passes — 1a6390e

#### Manual

- [x] 1.3 Dry run reports the expected changes (human-run) — 1a6390e
- [x] 1.4 Migration applies to the linked project (human-run) — 1a6390e
- [x] 1.5 Both tables visible in the Supabase dashboard with RLS enabled — 1a6390e
- [x] 1.6 Cross-user `proposals` insert is rejected by the policy — 1a6390e
- [x] 1.7 Selecting `proposals` as one user returns no other user's rows — 1a6390e

### Phase 2: Retrieval Layer

#### Automated

- [x] 2.1 Type checking passes — d2d7513
- [x] 2.2 Linting passes, including the react-compiler rule — d2d7513

#### Manual

- [x] 2.3 Sanitizer output contains no markup, backlinks, or macro figures — d2d7513
- [x] 2.4 Assembled set returns 4 distinct recipes spanning both requested cuisines — d2d7513
- [x] 2.5 Repeated calls return visibly different recipes — d2d7513

### Phase 3: Proposals Endpoint

#### Automated

- [x] 3.1 Type checking passes — cd9c9c3
- [x] 3.2 Linting passes — cd9c9c3

#### Manual

- [x] 3.3 Unauthenticated POST returns 401 and makes no provider call — cd9c9c3
- [x] 3.4 Signed-in POST returns 200 with 4 proposals across 2 cuisines — cd9c9c3
- [x] 3.5 `proposals` gains 4 correct rows; `requested_type` is null — cd9c9c3
- [x] 3.6 `recipes` upsert handles repeat ids without error — cd9c9c3
- [x] 3.7 No response body leaks a key, URL, or provider error string — cd9c9c3

### Phase 4: Dashboard UI

#### Automated

- [x] 4.1 Type checking passes
- [x] 4.2 Linting passes, including react-compiler and `astro/no-set-html-directive`

#### Manual

- [x] 4.3 Clicking renders 4 cards; double-clicks do not fire two requests
- [x] 4.4 Every card shows a publisher name and a working new-tab link
- [x] 4.5 Cards render legibly at 375px and in the 2-column layout
- [x] 4.6 Null or broken image shows the placeholder
- [x] 4.7 No excerpt contains markup, a spoonacular.com mention, or a calorie figure
- [x] 4.8 A forced 402 shows the quota-specific message with no retry affordance

### Phase 5: Deploy & Live Verification

#### Automated

- [ ] 5.1 CI run is green on the merge commit
- [ ] 5.2 Production responds with 200

#### Manual

- [ ] 5.3 Production "Get proposals" returns 4 cards spanning 2 cuisines
- [ ] 5.4 At least one publisher link resolves to a live external page
- [ ] 5.5 Supabase shows 4 new `proposals` rows with the two requested cuisines
- [ ] 5.6 Measured quota cost is ≈3.40 points
- [ ] 5.7 Dashboard is usable on a real phone browser
