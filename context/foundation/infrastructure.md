---
project: Co_jemy
researched_at: 2026-06-06
recommended_platform: Cloudflare Workers
runner_up: Netlify
context_type: mvp
tech_stack:
  language: JavaScript/TypeScript
  framework: Astro 6 (SSR) + React 19 + Tailwind 4
  runtime: Cloudflare Workers (workerd) via @astrojs/cloudflare
---

## Recommendation

**Deploy on Cloudflare Workers.**

Cloudflare scores 5/5 on the agent-friendly criteria and is the only candidate that requires **zero adapter migration** — the stack already pins `@astrojs/cloudflare`. It matches the developer's existing familiarity (interview Q3), costs **$0 at MVP scale** (the app stays inside the 100k-requests/day free tier, and static assets are free and unlimited), and offers full CLI (`wrangler`) plus GA MCP-server operability. Supabase remains an external provider (interview Q5), and the no-persistent-connection requirement (Q1) means the serverless model is a clean fit. The single contract correction required: the project must deploy to **Workers**, not Pages — the adapter dropped Pages support.

## Platform Comparison

Scored Pass / Partial / Fail against the five agent-friendly criteria (`references/agent-friendly-criteria.md`). Hard filters applied first: no persistent-connection requirement (Q1=No), so no platform was dropped for being serverless; all six can run Astro 6 SSR (JS), though four require swapping away from the pinned Cloudflare adapter.

| Platform | CLI-first | Managed/Serverless | Agent docs | Stable deploy API | MCP/Integration | Score |
|---|---|---|---|---|---|---|
| **Cloudflare** | Pass | Pass | Pass | Pass | Pass | **5 Pass** |
| **Netlify** | Pass | Pass | Pass | Pass | Pass | **5 Pass** |
| **Vercel** | Pass | Pass | Pass | Pass | Partial | 4P + 1 Partial |
| **Railway** | Pass | Pass | Pass | Pass | Partial | 4P + 1 Partial |
| **Render** | Pass | Pass | Pass | Partial | Pass | 4P + 1 Partial |
| **Fly.io** | Pass | Partial | Partial | Partial | Partial | 1P + 4 Partial |

**Per-platform notes:**

- **Cloudflare** — `wrangler deploy` / `wrangler rollback` / `wrangler tail` cover the full ops loop (CLI Pass). Fully managed serverless; static assets free and unlimited (Managed Pass). Docs are markdown on GitHub with per-product `llms.txt` (Docs Pass). `wrangler deploy` is deterministic with a dedicated rollback verb (Deploy API Pass). GA MCP servers for docs, bindings, and observability (MCP Pass). Hyperdrive (GA, free since Apr 2025) optionally accelerates Supabase Postgres.
- **Netlify** — `netlify deploy --prod` (draft-by-default is a safety feature), `netlify rollback`, `netlify logs --follow` (CLI Pass). Serverless Functions + optional edge middleware (Managed Pass). `llms.txt` + `.md` doc pages (Docs Pass). Atomic deploys with instant rollback (Deploy API Pass). Official `@netlify/mcp`, GA since 2025-06 (MCP Pass). Trade-offs vs. Cloudflare: requires an `@astrojs/netlify` adapter swap, and credit-based billing (changed 2025-09) may exceed the free allowance near 100k req/mo.
- **Vercel** — Excellent `vercel` / `vercel --prod` / `vercel rollback` / `vercel logs` CLI (Pass). Node Functions, scale-to-zero (Managed Pass). `llms.txt` + MDX docs (Docs Pass). Deterministic deploy/rollback (Deploy API Pass). MCP is **beta + read-only** as of 2026-06 (MCP Partial). Two real caveats: the Hobby tier is **non-commercial-only** (Pro $20/seat for any revenue use), and it needs an adapter swap.
- **Railway** — `railway up` / `railway redeploy` / `railway logs`, exit-code clean (CLI Pass). Railpack auto-build, no Dockerfile, persistent containers (Managed Pass). `llms-full.txt` + `.md` docs (Docs Pass). Scriptable deploy/redeploy (Deploy API Pass). MCP is **beta/WIP** (MCP Partial). No free tier — Hobby $5/mo minimum; persistent containers are overkill for a stateless app.
- **Render** — GA Go CLI v2.20.0, scriptable with `-o json` (CLI Pass). Managed Node Web Service (Managed Pass). `llms.txt` + docs MCP (Docs Pass). Rollback is via REST API/dashboard, **not a first-class CLI verb** (Deploy API Partial). GA MCP server since 2025-08 (MCP Pass). Free tier spins down with ~30–60s cold starts — must budget $7/mo Starter from launch, which would compound retrieval latency on every cold proposal request.
- **Fly.io** — `flyctl` covers deploy/logs (CLI Pass), but it runs **containers requiring a Dockerfile** (Managed Partial — more raw infra than MVP needs), has no `llms.txt` (Docs Partial), no first-class rollback command (Deploy API Partial), and an **experimental** MCP wrapper (MCP Partial). Free tier removed; persistent-VM strengths are irrelevant given the stateless PRD. Lowest fit.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Won on every axis that matters for this project: 5/5 criteria, **zero migration cost** (the adapter is already pinned), developer familiarity, $0 at MVP scale, and first-class agent operability (wrangler + GA MCP). The only work is correcting the stale "Pages" references in `tech-stack.md`/`CLAUDE.md` to "Workers" — a contract fix, not a platform risk. Single-region preference (Q4) means Cloudflare's global edge is not strictly needed, but it costs nothing extra and the free tier is genuinely free here.

#### 2. Netlify

Also a clean 5/5 with a GA MCP server and the safest deploy default (draft unless `--prod`). It loses to Cloudflare only on cost-certainty (credit billing can exceed free near 100k req/mo) and on requiring an adapter swap away from the pinned Cloudflare adapter. The strongest fallback if Cloudflare's Workers/Supabase connection model proves troublesome.

#### 3. Vercel

Best-in-class DX and GA tooling across the board, with the largest body of Astro deployment examples. Drops to third on two concrete issues: MCP is still beta/read-only, and the Hobby tier is **non-commercial-only** — any future monetization of "Co jemy?" forces a $20/seat Pro plan. Like Netlify, it requires an adapter swap.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **The Pages→Workers migration is a live contract trap.** `@astrojs/cloudflare` dropped Pages support, but `tech-stack.md` and `CLAUDE.md` still say "Cloudflare **Pages**" with "auto-deploy-on-merge." Using `wrangler pages deploy` or the Pages GitHub integration will fight the current adapter. Correct path is `wrangler deploy` (Workers + Static Assets).
2. **Supabase Postgres from Workers needs deliberate connection handling.** Workers hold no persistent TCP pool; naive `pg` connections exhaust Supabase's connection limit under concurrency. Must route through Supabase's pooler (Supavisor, transaction mode) or add Hyperdrive.
3. **`nodejs_compat` is partial, not full Node.** Any dependency that reaches a Node API outside the compat shim fails at runtime, not build time. React 19 SSR itself is fine; third-party SDKs are the risk. *Largely defused 2026-07-18:* FR-003's retrieval is now the Spoonacular REST API called with global `fetch` and no SDK, so the highest-risk dependency this warning was written about no longer exists. The warning still stands for anything added later.
4. **Free-tier CPU is 10ms wall-of-CPU, not wall-clock.** Awaiting the external Spoonacular call doesn't count, but synchronous parsing/ranking inside the 4-slot proposal logic does. Heavy slot-3 taste-profile computation could trip the limit and force the $5 plan. Lower risk since the pivot: the taste profile is now a handful of structured facet filters rather than open-ended text processing.
5. **`Astro.locals.runtime.env` was removed (adapter v13).** Env/secrets must be read via `import { env } from 'cloudflare:workers'`. Tutorial-copied SSR env code will be silently wrong.

### Pre-Mortem — How This Could Fail

The team shipped to Workers on day one and it felt free and fast. The first real failure came from Supabase: under a modest burst of concurrent proposal requests, the app exhausted Postgres connections because each Worker invocation opened a fresh connection instead of routing through Supavisor — intermittent 500s invisible in local `astro dev`. The team then discovered their CI still ran the old Pages deploy integration inherited from the starter shape, so half their "deploys" were no-ops against a stale Pages project while `wrangler deploy` updated a different Worker — two prod surfaces, silent drift. Finally, the 10ms free-tier CPU ceiling was hit once slot-3 ranking grew beyond a trivial sort, pushing an unplanned jump to the $5 plan. None of these were Cloudflare's fault — each was an assumption ("it's just Node," "Pages and Workers are interchangeable," "Supabase connections are free") that local dev never falsified.

*(Amended 2026-07-18: this pre-mortem originally also predicted that the AI-search SDK behind FR-003 would depend on a Node API absent from `nodejs_compat`, forcing a mid-project rewrite to a fetch-based client. The pivot to Spoonacular pre-empts that failure — it is fetch-based by construction. The replacement failure to fear is economic rather than technical: the free plan's 50 points/day quietly runs out mid-afternoon during a testing session, the API starts returning 402, and the app's proposal endpoint fails in a way that looks like a bug rather than a budget — the same class of assumption, just about money instead of runtimes.)*

### Unknown Unknowns

- **Local dev fidelity is now genuinely high** — Astro 6 runs `astro dev`/`astro preview` on the real `workerd` runtime via the Cloudflare Vite plugin, so a separate `wrangler dev` step is largely redundant. Old tutorials prescribing `wrangler dev` add confusion; the version-accurate workflow is plain `astro dev`.
- **Hyperdrive is GA and free since April 2025** — the Supabase connection-pooling fix is available at $0, but you must opt in; it is not automatic.
- **Static assets are free, unlimited, and served before the Worker runs** — Astro's static output costs nothing and never counts against the 100k/day request limit, making the free tier far more generous than the headline number for a mostly-static SSR app.
- **Secrets must be set as Worker secrets, not committed `.env`.** `SUPABASE_KEY` requires `wrangler secret put` for production; a committed `.env`/`.dev.vars` is read only locally, never in the deployed Worker.

## Operational Story

How Cloudflare Workers operates day to day for this project. One concrete answer per line.

- **Preview deploys**: `wrangler versions upload` creates a preview Worker version with a unique `*.workers.dev` preview URL without promoting to production; or connect the GitHub integration so each PR branch gets a preview deployment. Preview URLs are public by default — gate with Cloudflare Access if proposals/ratings must not be world-readable before launch. (Note: use the Workers Builds / `wrangler` path, **not** the legacy Pages CI, which the adapter no longer targets.)
- **Secrets**: `SUPABASE_URL` and `SUPABASE_KEY` are set as Worker secrets via `wrangler secret put SUPABASE_KEY` (encrypted at rest, readable only by the Worker at runtime, not printable back). Local dev reads them from `.dev.vars` (git-ignored). CI sets them via `CLOUDFLARE_API_TOKEN` + `wrangler secret` or the dashboard. Rotation: re-run `wrangler secret put` with the new value and redeploy.
- **Rollback**: `wrangler deployments list` to find the prior deployment ID, then `wrangler rollback [deployment-id]` — typically reverts in seconds. Caveat: rollback reverts the Worker code only; it does **not** roll back Supabase schema migrations, so DB changes must be backward-compatible across a rollback.
- **Approval**: an agent may run `wrangler deploy` / `wrangler tail` / `wrangler deployments list` / `wrangler rollback` unattended. Human-only (panel-by-hand): rotating the Supabase service key, dropping/altering production Postgres tables, deleting the Worker or project, and changing the billing tier. Use a Cloudflare API token scoped to Workers for this one project — no DNS, no unrelated secrets, no billing.
- **Logs**: `wrangler tail` streams live runtime logs (filterable `--status error`, `--format json`); `wrangler deployments list` shows deploy history. For structured agent queries, the GA `observability.mcp.cloudflare.com` MCP server exposes logs/analytics as typed tools.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Stale "Pages" contract — adapter dropped Pages; CI/docs still say Pages | Devil's advocate | H | H | Update `tech-stack.md` + `CLAUDE.md` to "Workers"; deploy via `wrangler deploy`, not `wrangler pages deploy`; wire Workers Builds (not Pages CI). Fix before bootstrapper/CI runs. |
| Supabase Postgres connection exhaustion from per-invocation Worker connections | Pre-mortem | M | H | Connect via Supabase Supavisor pooler (transaction mode) or add Hyperdrive (GA, free); never open raw `pg` connections per request. |
| ~~AI-search SDK (FR-003) depends on a Node API absent from `nodejs_compat`~~ **Retired 2026-07-18** | Devil's advocate / Pre-mortem | — | — | Dissolved by the pivot to Spoonacular: a plain REST endpoint called with global `fetch` has no `nodejs_compat` surface and no SDK. |
| Spoonacular free-plan quota (50 points/day) exhausted by development testing or real use, returning HTTP 402 | Pivot research 2026-07-18 | H | H | Measure real per-proposal-set cost in the F-01 spike; minimize *call count* (one per pinned cuisine, never one per slot) since each call pays a full point of base cost while extra results are nearly free; handle 402 as an explicit user-facing state, not a generic 500; budget the $29/mo tier as the escape hatch — likely needed before launch, not after, given ~10–21 sets/day. |
| Provider terms restrict storage to recipe id, title, and image URL — a cached description column would breach them | Pivot research 2026-07-18 | M | H | Encode the limit in the schema from the first migration (PRD FR-011); fetch descriptions live; never add a recipe-body cache without prior written permission from the provider. |
| `SPOONACULAR_API_KEY` leaks to the client because proposal assembly runs browser-side | Pivot research 2026-07-18 | M | H | Keep all proposal assembly server-side; set the key via `wrangler secret put`; never expose it through a public env prefix or a client-side fetch. |
| Free-tier 10ms CPU limit tripped by synchronous 4-slot ranking (esp. slot 3) | Pre-mortem | L | M | Keep slot logic light; offload heavy ranking to Postgres/SQL where possible; budget the $5/mo Workers Paid plan as the cheap escape hatch. |
| Wrong env-access pattern — `Astro.locals.runtime.env` removed in adapter v13 | Unknown unknowns | M | M | Read env via `import { env } from 'cloudflare:workers'`; audit any tutorial-copied SSR env code. |
| Production secret committed in `.env` instead of set as Worker secret | Unknown unknowns | M | H | Use `wrangler secret put` for `SUPABASE_KEY`; keep `.dev.vars`/`.env` git-ignored; never rely on committed env for the deployed Worker. |
| Two prod surfaces (stale Pages project + new Worker) causing silent deploy drift | Pre-mortem | M | M | Delete/disable any legacy Pages project; confirm a single deploy target; verify the live URL after each deploy. |
| Preview URLs publicly accessible before launch | Research finding | L | M | Gate preview/staging with Cloudflare Access if pre-launch data must stay private. |
| DB migration not reversible on code rollback | Research finding | L | M | Keep Supabase migrations backward-compatible; treat schema changes as forward-only across a Worker rollback. |

## Getting Started

Version-accurate for Astro 6 + `@astrojs/cloudflare` (Workers, not Pages) as of 2026-06-06.

1. **Confirm the adapter targets Workers.** Ensure `@astrojs/cloudflare` is installed and `astro.config.mjs` uses `output: 'server'` with the Cloudflare adapter. In `wrangler.jsonc`/`wrangler.toml` set `compatibility_date` to `2024-09-23` or later and `compatibility_flags = ["nodejs_compat"]`.
2. **Develop locally with `npm run dev`.** Astro 6 runs the real `workerd` runtime via the Cloudflare Vite plugin — no separate `wrangler dev` needed. Put `SUPABASE_URL`/`SUPABASE_KEY` in a git-ignored `.dev.vars`.
3. **Authenticate and deploy.** `npx wrangler login` (or set `CLOUDFLARE_API_TOKEN` scoped to Workers for this project), then `npm run build && npx wrangler deploy`. The first deploy returns the live `*.workers.dev` URL.
4. **Set production secrets.** `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY` — do not rely on a committed `.env` in production.
5. **Wire Supabase pooling and verify.** Connect Supabase via the Supavisor pooler (transaction mode) or add Hyperdrive (`npx wrangler hyperdrive create`); then `npx wrangler tail` to confirm the proposal/rating endpoints work against live Postgres without connection errors.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup
- Production-scale architecture (multi-region, HA, DR)
