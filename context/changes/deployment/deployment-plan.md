# Cloudflare Workers Integration & Deployment Plan — "Co jemy?"

## Context

The goal is the first production deployment of the "Co jemy?" auth scaffold to **Cloudflare Workers**, per [`context/foundation/infrastructure.md`](../../foundation/infrastructure.md). Research (2026-06-06) picked Cloudflare Workers as the recommended platform: zero adapter migration, $0 at MVP scale, full `wrangler` CLI operability.

**The codebase is already deployment-ready in config:**
- `@astrojs/cloudflare@13.5.0` adapter, `output: "server"`, env schema for Supabase secrets — `astro.config.mjs`
- `wrangler.jsonc` correctly targets **Workers** (`main: "@astrojs/cloudflare/entrypoints/server"`, `compatibility_flags: ["nodejs_compat"]`, `assets` → `./dist`, observability on)
- Supabase client reads env via `astro:env/server` — `src/lib/supabase.ts` — used uniformly by middleware and all three auth API routes. No Node-only APIs anywhere.

**Two infra-doc risks are resolved/reduced by web verification (2026-06):**
1. **"Pages→Workers" trap is already avoided in code** — the adapter and `wrangler.jsonc` target Workers. Only the *prose docs* (`CLAUDE.md`, `tech-stack.md`) still say "Pages". Documentation-only fix.
2. **"Supabase Postgres connection exhaustion" does NOT apply to this stack** — `@supabase/ssr`/`@supabase/supabase-js` talk to Supabase over HTTP/PostgREST via `fetch`, never raw Postgres TCP. [Supabase confirms](https://supabase.com/partners/integrations/cloudflare-workers) connection pooling is unnecessary. **Hyperdrive/Supavisor are dropped from scope** — they'd only matter if a direct `pg`/Drizzle driver were added later (e.g. for heavy slot-3 ranking in FR-008).

**Decisions (from clarification):** First deploy authenticates via `wrangler login` (OAuth); ship manually first, then add GitHub Actions auto-deploy; rename the Worker `10x-astro-starter` → `co-jemy`; **provision production only** (single environment — use free `wrangler versions upload` preview URLs for safe testing; add a dedicated staging Worker + second Supabase project only once there are real users to isolate).

**Scope note:** Only the auth scaffold exists today (signin/signup/signout/confirm-email + protected `/dashboard`). The recipe-proposal / rating features (FR-003..FR-009) and the AI-search SDK are **not built yet** — their deployment-specific edge cases are flagged for when they land, not handled now.

---

## Phase 0 — Contract & config fixes (no deploy yet)

- [ ] Rename the Worker in `wrangler.jsonc`: `"name": "10x-astro-starter"` → `"name": "co-jemy"`. This becomes the `co-jemy.<account>.workers.dev` subdomain.
- [ ] Fix stale "Pages" prose in `CLAUDE.md` (project line: "deployed to Cloudflare Pages" → "Cloudflare Workers") and `context/foundation/tech-stack.md` (frontmatter `deployment_target: cloudflare-pages` → `cloudflare-workers`; "Cloudflare Pages (the starter default)" / "auto-deploy-on-merge" prose → Workers via `wrangler deploy`). Closes the H/H "stale Pages contract" risk in the register.
- [ ] Sanity-check `compatibility_date` in `wrangler.jsonc` is `2024-09-23` or later (currently `2026-05-08` ✓).

## Phase 1 — Local verification on the real runtime

- [ ] Create a git-ignored `.dev.vars` at repo root (NOT `.env`) with real values:
  ```
  SUPABASE_URL=https://<project-ref>.supabase.co
  SUPABASE_KEY=<anon-public-key>
  ```
  `.dev.vars` is already in `.gitignore` ✓. Use the **anon/public** key (the SSR client + RLS is the security boundary), not the service-role key.
- [ ] `npm install` then `npm run astro sync` (regenerate `astro:env` + `.astro` types; CI does this and it is not automatic locally per `CLAUDE.md`).
- [ ] `npm run dev` — Astro 6 runs the real `workerd` runtime via the Cloudflare Vite plugin, so this is a faithful pre-deploy check (no separate `wrangler dev` needed).
- [ ] Manually exercise the auth loop against live Supabase: sign up → confirm-email page → sign in → reach `/dashboard` → sign out. Confirm `context.locals.user` populates (middleware) and the protected-route redirect works.
- [ ] `npm run lint` and `npm run build` both clean. Confirm `react-compiler/react-compiler: "error"` passes.
- [ ] **Edge case — secrets read `undefined` at runtime:** if the live Worker (Phase 2) returns "Supabase is not configured" despite secrets being set, add `nodejs_compat_populate_process_env` to `compatibility_flags` in `wrangler.jsonc` and redeploy ([astro#13503](https://github.com/withastro/astro/issues/13503), known v13 gotcha for global-scope `astro:env` resolution). Static `import { SUPABASE_URL } from "astro:env/server"` is the supported pattern; this flag is the documented fallback.

## Phase 2 — First manual deploy

- [ ] `npx wrangler login` — interactive OAuth in the browser; authorizes `wrangler` against your Cloudflare account.
- [ ] `npm run build && npx wrangler deploy`. The build emits `dist/`; `wrangler deploy` uploads the Worker + static assets and prints the live `https://co-jemy.<account>.workers.dev` URL.
- [ ] Load the URL — the landing page and static assets should serve (assets are served before the Worker runs, free/unlimited). Expect auth to fail gracefully until Phase 3 (no production secrets yet).
- [ ] **Edge case — deploy drift / two prod surfaces:** confirm there is exactly ONE deploy target. Do NOT run `wrangler pages deploy` and do NOT connect a Pages GitHub integration (the adapter dropped Pages). If a legacy Pages project exists in the dashboard from the starter, delete/disable it. Verify the live URL after deploy (M/M "silent deploy drift" risk).

## Phase 3 — Production secrets

- [ ] `npx wrangler secret put SUPABASE_URL` then `npx wrangler secret put SUPABASE_KEY` — sets encrypted Worker secrets (readable by the Worker at runtime, not printable back, never committed). These are independent of `.dev.vars` (local-only).
- [ ] `npx wrangler deploy` again (or it picks up secrets on next request — redeploy to be safe), then reload the live URL.
- [ ] **Edge case — build-time vs runtime secrets:** the env-schema fields use `access: "secret"`, so they resolve at **runtime** from Worker secrets, not baked at build. The CI build passing `SUPABASE_URL/KEY` is harmless but not what makes prod work — `wrangler secret put` is. Do not assume a successful build means secrets reached the live Worker.

## Phase 4 — Wire the external Supabase integration to the live domain

- [ ] In the Supabase dashboard → **Authentication → URL Configuration**: set **Site URL** to `https://co-jemy.<account>.workers.dev` and add it to **Redirect URLs**. Without this, email-confirmation links from sign-up point to `localhost` and the `confirm-email` flow breaks in production.
- [ ] Verify the full live auth loop end-to-end on the deployed URL: register → receive confirmation email → link lands on the deployed domain → sign in → `/dashboard` → sign out. This is the deployment-critical external-integration test.
- [ ] **Edge case — auth cookies over HTTPS:** `@supabase/ssr` sets session cookies via `AstroCookies`; confirm cookies persist across requests on the `*.workers.dev` HTTPS origin (Secure/SameSite). If session doesn't survive navigation, inspect Set-Cookie attributes.
- [ ] **Edge case — Supabase free-tier email rate limits:** the built-in email sender is rate-limited (a few/hour). If confirmation emails stall during testing, that's the limiter, not a code bug — wait or configure a custom SMTP provider.
- [ ] **Edge case (forward-looking, FR-003 not built yet):** when the AI-search SDK is added, verify it against `nodejs_compat` in a *deployed* Worker, not just local dev — prefer a `fetch`-based client; a Node-API-only SDK fails at runtime, not build time (M/M risk).

## Phase 5 — CI auto-deploy on merge to master

- [ ] Create a **scoped** Cloudflare API token (dashboard → My Profile → API Tokens → "Edit Cloudflare Workers" template, restricted to this account/Worker; no DNS, no billing, no unrelated secrets — per the infra doc's minimal-permissions posture). Store as GitHub repo secret `CLOUDFLARE_API_TOKEN`.
- [ ] Add `.github/workflows/deploy.yml`: trigger on push to `master`, run `npm ci` → `npx astro sync` → `npm run build`, then deploy with `cloudflare/wrangler-action@v3` (passes `apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}`). Mirror the Node 22 / `astro sync` steps from the existing `.github/workflows/ci.yml`.
- [ ] Keep production secrets as Worker secrets (set once in Phase 3) — CI does NOT need `SUPABASE_*` for runtime, only `CLOUDFLARE_API_TOKEN`. (The existing CI build job may keep its `SUPABASE_*` build env; not required for the deploy job.)
- [ ] **Edge case — deploy job runs before lint/build passes:** make the deploy job `needs:` the existing CI job (or gate on a successful build) so a broken build never ships.
- [ ] Trigger a test merge and confirm the Action deploys and the live URL updates.

## Phase 6 — Operability & guardrails (document, then verify)

- [ ] Smoke `npx wrangler tail` (filter `--status error`) against the live Worker while exercising auth — confirm structured runtime logs stream.
- [ ] Rollback drill: `npx wrangler deployments list` → `npx wrangler rollback <id>` reverts in seconds. **Caveat:** rollback reverts Worker code only, NOT Supabase schema — keep any future DB migrations backward-compatible across a rollback.
- [ ] Record the production-access boundary (in `CLAUDE.md` or a deploy note): agent may run `wrangler deploy` / `tail` / `deployments list` / `rollback` unattended; **human-only** = rotating the Supabase key, altering/dropping prod tables, deleting the Worker, changing billing tier.

---

## Files to be created / modified

| File | Change |
|---|---|
| `wrangler.jsonc` | Rename Worker `10x-astro-starter` → `co-jemy`; (conditional) add `nodejs_compat_populate_process_env` flag if secrets read undefined |
| `CLAUDE.md` | "Cloudflare Pages" → "Cloudflare Workers" in project description |
| `context/foundation/tech-stack.md` | Frontmatter `deployment_target` + prose: Pages → Workers / `wrangler deploy` |
| `.dev.vars` | **New, git-ignored** — local `SUPABASE_URL`/`SUPABASE_KEY` |
| `.github/workflows/deploy.yml` | **New** — auto-deploy on merge to `master` via `wrangler-action` |

**Unchanged (already correct):** `astro.config.mjs`, `src/lib/supabase.ts`, `src/middleware.ts`, all `src/pages/api/auth/*` — no code edits needed for deployment.

## Verification (end-to-end)

1. **Local:** `npm run dev` → full auth loop works against live Supabase; `npm run lint && npm run build` clean.
2. **Live (manual):** `wrangler deploy` → `co-jemy.<account>.workers.dev` serves; after Phase 3+4, register → email confirm (lands on prod domain) → sign in → `/dashboard` → sign out, all on the live URL.
3. **Logs:** `wrangler tail --status error` shows no runtime errors during the live auth loop.
4. **CI:** a merge to `master` triggers `deploy.yml` and the live URL reflects the change.
5. **Rollback:** `wrangler deployments list` + `wrangler rollback <id>` confirmed reversible.

## Out of scope (per infra doc)

Hyperdrive/Supavisor pooling (N/A — supabase-js is REST/fetch), a second/staging environment (production-only for now), custom domain, Cloudflare Access gating of preview URLs, multi-region/HA, Docker, and the unbuilt recipe-proposal/AI-search features (FR-003..FR-009).

---

## Progress log

| Phase | Status |
|---|---|
| 0 — Contract & config fixes | 🟡 In progress — Worker renamed to `co-jemy` ✓; doc prose fixes pending |
| 1 — Local verification | ⬜ Not started |
| 2 — First manual deploy | ⬜ Not started (needs `wrangler login`) |
| 3 — Production secrets | ⬜ Not started (needs Supabase credentials) |
| 4 — Supabase live wiring | ⬜ Not started (Supabase dashboard) |
| 5 — CI auto-deploy | ⬜ Not started |
| 6 — Operability & guardrails | ⬜ Not started |
