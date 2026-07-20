---
date: 2026-07-20T19:28:11+02:00
researcher: Claude (Fable 5)
git_commit: 793307e4767d44385f4aa7c21d4275cbe93c4fa6
branch: master
repository: Co_jemy
topic: "Cold-start proposals from the Spoonacular API (roadmap slice S-02)"
tags: [research, codebase, spoonacular, proposals, supabase, migrations, api-endpoint, frontend]
status: complete
last_updated: 2026-07-20
last_updated_by: Claude (Fable 5)
---

# Research: Cold-start proposals from the Spoonacular API (S-02)

**Date**: 2026-07-20T19:28:11+02:00
**Researcher**: Claude (Fable 5)
**Git Commit**: `793307e4767d44385f4aa7c21d4275cbe93c4fa6`
**Branch**: `master`
**Repository**: Co_jemy (github.com/KSchlagowski/Co_jemy)

## Research Question

What codebase evidence — existing patterns, conventions, integration points, and banked spike findings — should shape the plan for `cold-start-proposals` (S-02): a logged-in user with no ratings requests proposals and sees 4 real recipes from ≥2 cuisines, each with title, brief description, and working external link; dead links are signaled; proposed recipes are recorded so they can be rated later?

## Summary

The Spoonacular client (`src/lib/spoonacular.ts`) is production-hardened and waiting — S-02 is its **first live consumer**. The quota economics are fully measured and binding: a 2-cuisine cold-start set costs 2.71 points, so **default to 2 cuisines per set** and rotate pairs across requests; over-fetch within calls (`number=20+`), never add calls. Everything else the slice needs is **net-new**: the first Supabase migration (no `supabase/migrations/` exists), the first authenticated JSON API endpoint (middleware does not guard `/api/**`; no JSON error convention exists), and the first client-side fetch→render UI flow (all existing forms are native POST+redirect). One explicit precondition was left by the spike's implementation review: `toCandidate` blind-casts provider payload fields and must gain validation before proposal logic consumes it. The schema decision is already made upstream: the first migration records `spoonacular_id`, `title`, `image` (the only three storable provider fields) **plus** the app's own request-side facets (requested `cuisine`, requested `type` if sent) and a proposed-at timestamp — and must never persist `summary`, `cuisines[]`, or `dishTypes[]`.

## Detailed Findings

### 1. Spoonacular client — exists, hardened, zero live callers

`src/lib/spoonacular.ts` (128 lines, hardened in `a29c19e`):

- **Exports**: `searchRecipes(params: SearchParams)` (`src/lib/spoonacular.ts:110-122`), `getRecipeById(id: number)` (`:125-127`), types `RecipeCandidate` (`:6-14`), `QuotaInfo` (`:17-21`), `SpoonacularResult` (`:23-30`), `SearchParams` (`:32-37`).
- **`RecipeCandidate`** is exactly the proposal-card shape: `id, title, image|null, summary|null, sourceName|null, sourceUrl|null, spoonacularSourceUrl|null` — deliberately narrow per FR-011 ("nothing else leaves this module").
- **`SpoonacularResult`** is a discriminated union; failures are typed: `quota_exhausted` (402), `http_error`, `not_configured` (missing key), `network_error` (fetch/parse — swallowed deliberately so the key-bearing URL can't leak into Workers observability, `:84-85`).
- **`searchRecipes`** hardcodes `addRecipeInformation=true` (`:111`), passes `cuisine` (single string), `number`, `offset` (clamped 0–900, `:114-115`), `sort` (typed literal `"random"` only). Nutrition flags are never sent.
- **Quota telemetry**: `parseQuota` (`:39-49`) reads `X-API-Quota-Used/Request/Left` headers into `QuotaInfo`; returned to callers but **nothing budgets against it** — no runtime gate, no counter store, no caching, no KV binding.
- **Env**: `SPOONACULAR_API_KEY` via `astro:env/server` (`:1`), declared `optional: true` in `astro.config.mjs:21`; the client null-checks (`:70`).
- **Gaps for S-02**: no cuisine list constant anywhere; no `type` (meal type) param in `SearchParams` despite the roadmap decision to persist requested `type`; no multi-cuisine fan-out helper; no bulk id lookup (`informationBulk` unwrapped); `toCandidate` (`:51-61`) blind-casts (`raw.id as number`) with **no validation** — flagged as an explicit S-02 precondition (F5) in the spike's review triage.
- **Spike endpoint deleted** (`5cee1de`); `src/pages/api/` contains only `auth/*`. Stale leftover: `SPIKE_TOKEN=...` still sits in `.dev.vars` but is no longer in the env schema (harmless; worth cleanup).
- **No tests exist anywhere** in the project; verification convention is lint + build + manual live checklist.

### 2. API endpoint, auth, and data-layer patterns

- **Endpoint typing pattern**: `export const POST: APIRoute = async (context) => {...}` — single `context` param, no `prerender` flag (global `output: "server"`, `astro.config.mjs:11`).
- **Best template**: `src/pages/api/auth/callback.ts:20-42` — the only endpoint parsing JSON and returning real `Response` objects (try/catch on `request.json()` → 400; 204/401/500 by case). All other auth endpoints are form-POST + redirect.
- **No JSON error envelope exists** — responses are plain-text bodies or redirects with `?error=` query params. S-02 defines the first JSON response convention.
- **Middleware** (`src/middleware.ts`): `PROTECTED_ROUTES = ["/dashboard"]` (`:4`); populates `context.locals.user` via `supabase.auth.getUser()` (`:7-13`); redirects to `/auth/signin`. **`/api/**` is not guarded** — a proposals endpoint must check `context.locals.user` itself and return 401 (not redirect). No existing endpoint reads `locals.user` yet; S-02's would be the first.
- **Locals typing**: `src/env.d.ts:1-5` — `App.Locals` has only `user: User | null`.
- **Supabase client**: single factory `createClient(requestHeaders, cookies)` in `src/lib/supabase.ts:5` using `@supabase/ssr` `createServerClient`; env via `astro:env/server`; returns `null` when unconfigured (every caller null-checks). **Anon key only — no service-role client or env var exists.** Inserts either ride the user's RLS session or require adding a service-role client + env field.
- **Database state**: `supabase/` exists with `config.toml` (migrations enabled, `schema_paths = []`; seed path points at nonexistent `seed.sql`; Postgres 17) but **no `migrations/` dir, no `.sql` files, no generated DB types, no RLS policies, no ORM**. `supabase` CLI `^2.109.0` is a devDependency, so tooling for the first migration is installed.
- **Validation**: no zod/yup/valibot; convention is manual `typeof` guards (`callback.ts:29,34`).
- **Logging**: essentially none, deliberately — `spoonacular.ts` comments forbid logging the key-bearing URL.

### 3. Frontend page & component patterns

- **Protected-page template**: `src/pages/dashboard.astro` — `const { user } = Astro.locals` (`:4`), `<Layout title=...>`, page shell `bg-cosmic flex min-h-screen ... p-4`, glass card `rounded-2xl border border-white/10 bg-white/10 p-8 ... backdrop-blur-xl` (`:8-9`). A `/proposals` page must also be added to `PROTECTED_ROUTES` (`src/middleware.ts:4`).
- **React conventions**: only `client:load` directive in use; forms are **native HTML POST** (`SignInForm.tsx:43`) with client-side-validation-only React; pending state via `useFormStatus` (`SubmitButton.tsx:12`) — which only works with native form submission. Plain `useState`, no `useActionState`/`useTransition`. **There is no client-side fetch→JSON→render pattern in the codebase** — S-02's on-demand card loading is a new pattern and must satisfy `react-compiler/react-compiler: "error"` (`eslint.config.js:52,58`).
- **Error surface**: inline red banner `ServerError.tsx:7-15` (returns null when no message); Astro `Banner.astro` for page-top notices. No toast system.
- **Styling**: Tailwind 4 CSS-first (`src/styles/global.css`) with shadcn tokens defined but largely unused by pages — actual pages use a hardcoded glassmorphism palette. Signature background `@utility bg-cosmic` (`global.css:113-115`). Card grid pattern to reuse: `grid grid-cols-1 gap-6 ... sm:grid-cols-3` (`Welcome.astro:57`). Primary button: `rounded-lg bg-purple-600 px-4 py-2 ... hover:bg-purple-500`. `cn()` helper at `src/lib/utils.ts:4`; shadcn `Button` with `cva` variants at `src/components/ui/button.tsx:50` (available, barely used). Icons: `lucide-react`.
- **Missing UI building blocks** (all net-new): recipe card component, image-with-fallback (`RecipeCandidate.image` is nullable + URLs rot → `onError` swap), external-link/dead-link signaling, skeleton/loading-list state, toast/notification.
- **Summary rendering constraint**: `astro/no-set-html-directive` is an ESLint **error** (`eslint.config.js:65`) — the HTML `summary` must be stripped/truncated server-side, never injected raw.
- **Navigation**: `Topbar.astro` renders only on the homepage; `dashboard.astro` has no nav besides sign-out. The dashboard card is the natural "Get proposals" CTA location; a cross-link Topbar↔dashboard↔proposals needs adding.
- **Shared types**: no `src/types.ts`; domain types live beside their module — `RecipeCandidate` et al. are importable via `@/lib/spoonacular` (alias `@/*` → `./src/*`, `tsconfig.json:8-11`).

### 4. Banked spike findings (F-01) — binding constraints for S-02

All from `context/archive/2026-07-16-spoonacular-retrieval-spike/` and `docs/reference/contract-surfaces.md` (seeded explicitly as "the binding schema/UI constraints for S-02").

**Measured costs** (formula confirmed exact: 1 pt/call + 0.035/recipe with `addRecipeInformation`):

| Scenario | Cost |
| --- | --- |
| Single cuisine-pinned call, `number=10`, `sort=random` | 1.35–1.36 pts |
| 2-cuisine cold-start set (2 calls) | 2.71 pts → ~18 sets/day |
| 4-cuisine set (4 calls) | 5.40 pts → ~9 sets/day |
| One call `number=100` (over-fetch) | 4.50 pts |
| Re-fetch by id (`/recipes/{id}/information`) | 1.00 pt |

**Binding request-shaping rules** (findings.md §3):
1. Cold-start defaults to **2 cuisines, not 4**; serve 4-cuisine diversity across *successive* requests (different pair each time).
2. **Over-fetch within calls** (`number=20+`) and draw multiple slots/sessions from the surplus rather than issuing new calls.
3. Dev discipline: ≤25 pts/day dev cap; 402 is an expected typed outcome.
4. Stay on the free plan through S-02; upgrade to $29/mo only if real usage regularly exceeds ~10 sets/day or dev hits 402 >1×/week despite the cap.

**Link/image posture** (measured): 49/50 `sourceUrl`s alive (98%); the one dead link's `spoonacularSourceUrl` worked. Verdict: **graceful error state, no active reachability check** — link to `sourceUrl`, fall back to `spoonacularSourceUrl` when absent/dead, keep an image `onerror` fallback. Sample was foodista-skewed; posture-setting, not a guarantee.

**Quota headers** proved reliable per-call (`quota.request` matched the delta every time) — a sound instrument if S-02 adds runtime budget tracking.

### 5. Schema decision (already made upstream — not to re-litigate)

From roadmap S-02 unknowns (promoted to a decision 2026-07-18) and `contract-surfaces.md`:

- **Storable provider fields, exactly three**: `spoonacular_id`, `title`, `image` URL (hotlinked, never re-hosted).
- **Also stored, legally outside FR-011** (the app's own request/session data): requested `cuisine`, requested meal `type` (if sent), proposed-at timestamp. Without these, S-05 must re-fetch every liked recipe to infer a taste profile, which the free quota cannot sustain.
- **Never persist**: `summary`, `cuisines[]`, `dishTypes[]`, ingredients, instructions, nutrition — "in any form, including derived/transformed". The 1-hour cache allowance requires prior written permission: treat as unavailable. Card descriptions come from the live response only.
- **Separation guardrail**: shape the recipe-reference table with the future ratings split in mind — rating events (S-03) live logically separate from provider-derived reference data so they survive a forced provider-data purge.
- This is the **repo's first migration**; `supabase/migrations/` must be created. Rollback caveat from the deployment plan: `wrangler rollback` reverts Worker code only, not Supabase schema — keep migrations backward-compatible across a rollback. Production-access boundary: altering/dropping prod tables is **human-only**.

### 6. Deploy, CI, and verification conventions (from S-01)

- Production: `https://co-jemy.mediewilnp.workers.dev`, Worker `co-jemy`. Push to `master` → `.github/workflows/deploy.yml` (lint + build + `wrangler-action@v3`, concurrency-serialized); proven green on this commit (`793307e`).
- Secrets: Worker secrets via `wrangler secret put` (all three already set, including `SPOONACULAR_API_KEY`); rule of thumb — secrets exist **before** the merge that ships code using them.
- Verification: `npm run lint` + `npm run astro sync && npm run build` + manual live checklist; no test runner (arrives with Module 3).
- **Soft prerequisite**: S-01 live verification is incomplete (plan progress 3.3–3.5 unchecked; `change.md` status `implementing`). S-02's live verification needs a working production account. Supabase built-in SMTP is rate-limited to a few emails/hour — budget signups (plus-addressing).

## Code References

- `src/lib/spoonacular.ts:6-14` — `RecipeCandidate` (the card contract)
- `src/lib/spoonacular.ts:23-30` — `SpoonacularResult` discriminated union (error taxonomy to map to HTTP statuses)
- `src/lib/spoonacular.ts:51-61` — `toCandidate` blind casts (F5 precondition: add validation before S-02 consumes it)
- `src/lib/spoonacular.ts:110-122` — `searchRecipes` (no `type` param yet; `cuisine` is a bare string)
- `src/pages/api/auth/callback.ts:20-42` — the only JSON-parsing endpoint; best template for `/api/proposals`
- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard"]`; `/api/**` unguarded; add `/proposals` here
- `src/env.d.ts:1-5` — `App.Locals` (`user` only)
- `src/lib/supabase.ts:5` — `createClient(headers, cookies)`; anon key only, null when unconfigured
- `astro.config.mjs:17-23` — env schema (`envField`, all `optional: true`); any new env var goes here
- `src/pages/dashboard.astro:4-25` — protected-page template + natural "Get proposals" CTA location
- `src/components/auth/SubmitButton.tsx:12,22` — `useFormStatus` pending pattern (native-form only) + inline spinner
- `src/components/auth/ServerError.tsx:7-15` — inline error banner pattern
- `src/components/Welcome.astro:57` — responsive card-grid pattern to reuse for 4 proposal cards
- `src/styles/global.css:113-115` — `bg-cosmic` signature background
- `eslint.config.js:52,58,65` — react-compiler error rule; `astro/no-set-html-directive` error (no raw `summary` HTML)
- `supabase/config.toml:53-55` — migrations enabled, no migrations dir yet
- `wrangler.jsonc` — no KV/D1/R2 bindings, no vars; secrets out-of-band

GitHub permalink base (this commit is pushed): `https://github.com/KSchlagowski/Co_jemy/blob/793307e4767d44385f4aa7c21d4275cbe93c4fa6/<file>#L<line>`

## Architecture Insights

- **Result-union over exceptions**: `spoonacular.ts` established typed failure reasons instead of throws; the proposals endpoint should extend this style and map reasons to HTTP statuses (the deleted spike endpoint's mapping — ok→200, quota_exhausted→402, not_configured→503, else→502 — is a proven precedent).
- **`astro:env/server` everywhere**: no `locals.runtime.env`, no `import.meta.env` for secrets; the Cloudflare adapter bridges the schema to Worker env. Follow it.
- **Auth is page-centric today**: middleware guards pages and populates `locals.user`; APIs self-guard. S-02 writes the first `locals.user`-consuming, 401-returning endpoint.
- **Native-form-first frontend**: the codebase has deliberately avoided client fetch flows so far. S-02's interactive "request proposals" flow is the first genuine client-side data fetch; keep it small and react-compiler-clean.
- **Security lesson on the books** (`context/foundation/lessons.md`): any token/secret guard on a public `src/pages/api/**` endpoint must fail closed and use `crypto.subtle.timingSafeEqual`. S-02's endpoint is session-authed (cookies), not token-guarded, so this applies only if a guarded debug/spike endpoint reappears.
- **Key-secrecy discipline**: the Spoonacular key travels as a query param; never log/throw/return URLs containing it. Server-side only.

## Historical Context (from prior changes)

- `context/archive/2026-07-16-spoonacular-retrieval-spike/findings.md` — measured costs, binding request-shaping rules (§3), link-liveness verdict (§4), quota-header reliability (§1).
- `context/archive/2026-07-16-spoonacular-retrieval-spike/measurements.md` — raw M1–M5 measurements.
- `docs/reference/contract-surfaces.md` — the binding schema/UI constraint registry for S-02 (storable fields, attribution, summary display rule).
- `context/changes/spoonacular-retrieval-spike/follow-ups/review-fixes.md` — **F5 precondition**: validate `toCandidate` narrowing before S-02 consumes `RecipeCandidate`.
- `context/changes/production-auth-loop/plan.md` — deploy/CI/secrets/verification conventions; plan-document structure to mirror; S-01 manual verification (3.3–3.5) still open.
- `context/changes/deployment/deployment-plan.md` — production-access boundary (prod table changes human-only); rollback reverts code, not schema.
- `context/foundation/roadmap.md:97-108` — S-02 definition, promoted schema decision, risk framing.
- `context/foundation/lessons.md` — timing-safe token-guard rule for public API endpoints.

## Related Research

- `context/archive/2026-07-16-spoonacular-retrieval-spike/` — the F-01 spike is the direct research predecessor; its findings are treated as binding inputs here rather than re-verified.
- No other `research.md` artifacts exist under `context/changes/**` at this time.

## Open Questions

1. **RLS vs service-role for the proposals insert** — only the anon-key client exists. Recording proposed recipes can ride the user's RLS session (policy: user inserts own rows) or a new service-role client. RLS-only keeps the surface smaller; needs a decision in `/10x-plan`.
2. **Where does the shared recipe reference live vs the per-user proposal event?** The separation guardrail (ratings survive a provider purge) suggests two tables (`recipes` reference + per-user `proposals` events) even in S-02; the plan should fix the shape before S-03 builds on it.
3. **Runtime quota budgeting** — quota headers are reliable, but there is no store (no KV binding, no DB counter). Does S-02 ship a budget gate (e.g. refuse sets when `quota.left` is low) or just surface the typed 402 gracefully? The binding rules require only the latter; a gate is optional scope.
4. **`SearchParams` extension** — adding `type` (meal type) to the client is implied by the schema decision but not yet decided whether S-02 sends `type` at all (cold-start may pin cuisine only).
5. **Cuisine pair rotation** — "different pair each time" needs a mechanism (random pair per request vs. rotation keyed on something); no constant list of candidate cuisines exists yet (spike tested: italian, mexican, chinese, greek, thai, french — all returned full results).
6. **S-01 closure** — live verification (3.3–3.5) is still open; S-02's live verification depends on a working production account.
