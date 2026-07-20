# Production Auth Loop (S-01) Implementation Plan

## Overview

Close roadmap slice S-01: a real user can register on the live URL, receive a confirmation email that lands back on the production domain, click it and arrive **signed in** at the protected area, sign out, and sign in again. Along the way, prove the already-committed CI auto-deploy pipeline with this change's own merge. PRD refs: FR-001, FR-002. GitHub issue: https://github.com/KSchlagowski/Co_jemy/issues/2

## Current State Analysis

Auth scaffold is built and deployed to `co-jemy.mediewilnp.workers.dev`, but the confirmation loop is open:

- `src/pages/api/auth/signup.ts:13` calls `supabase.auth.signUp({ email, password })` with no options; after signup it redirects to the static `/auth/confirm-email` page.
- **No confirmation/callback route exists anywhere** — nothing in the repo calls `verifyOtp` or handles a `token_hash`. Clicking the emailed link completes nothing in-app; where it even lands depends entirely on the hosted Supabase project's Site URL setting.
- The only URLs in the repo point at `127.0.0.1:3000` (`supabase/config.toml:154-156`), and local config has `enable_confirmations = false` (`supabase/config.toml:209`) — local dev auto-confirms, which stays true after this change.
- `src/pages/auth/confirm-email.astro:4` branches on build-time `import.meta.env.DEV`: dev says "you can now sign in" (correct — auto-confirm), prod says "check your email" (correct as the post-signup interstitial). No change needed.
- `src/pages/api/auth/signin.ts:19` redirects sign-in success to `/`, not `/dashboard`.
- Middleware (`src/middleware.ts:4,18-22`) guards `/dashboard` and populates `locals.user` via `getUser()`; the Supabase SSR client (`src/lib/supabase.ts:5-21`) handles cookie read/write and returns `null` when env vars are unset.
- **CI is already committed** — `.github/workflows/ci.yml` (lint+build gate on push/PR) and `.github/workflows/deploy.yml` (push to master → lint+build → `wrangler-action` deploy). The issue #2 DoD item "commit the drafted workflow" is stale. What remains from `context/changes/deployment/deployment-plan.md` Phase 5: create the scoped `CLOUDFLARE_API_TOKEN` GitHub secret (human-only) and prove the pipeline with a real merge-triggered deploy. `deploy.yml:27-29` also needs `SUPABASE_URL`/`SUPABASE_KEY` repo secrets for the build step.
- Worker runtime secrets (`SUPABASE_URL`, `SUPABASE_KEY`, `SPOONACULAR_API_KEY`) are already set via `wrangler secret put` (deployment plan Phase 3; spike ran against the live Worker).

## Desired End State

- Production signup sends a confirmation email whose link hits `GET /api/auth/confirm` on the production domain; the route verifies the token, establishes the session, and lands the user signed in on `/dashboard`.
- Sign-in success also lands on `/dashboard`.
- `deploy.yml` has deployed this change to production via a push to master, with the workflow green.
- The full loop is verified live: register → email → click → signed-in dashboard → sign out → sign in.

### Key Discoveries:

- Canonical Supabase SSR confirmation pattern (Supabase docs, `guides/auth/passwords`): change the "Confirm signup" email template link to `{{ .SiteURL }}/<confirm-route>?token_hash={{ .TokenHash }}&type=email`, then verify server-side with `supabase.auth.verifyOtp({ type, token_hash })`. `verifyOtp` through the SSR client writes the session cookies — the user is signed in when the redirect fires.
- Because the template's `{{ .SiteURL }}` drives the link target, **no `emailRedirectTo` and no redirect-allow-list entry are needed** — the code delta is one new route plus a one-line redirect change.
- The production hostname appears nowhere in repo config (`wrangler.jsonc` has no routes); it lives only in the Supabase dashboard's Site URL after Phase 2. Acceptable for now — the workers.dev URL is stable.
- Built-in Supabase SMTP is rate-limited to a few emails per hour — live verification must budget signup attempts (use plus-addressing, e.g. `mediewilnp+test1@gmail.com`).
- Lesson register (`context/foundation/lessons.md`) has one rule about token guards on public endpoints; it does not apply here — the confirm route verifies a Supabase-issued OTP hash via `verifyOtp`, not a shared secret compared in our code.

## What We're NOT Doing

- No custom SMTP provider (Resend etc.) — built-in Supabase sender is the accepted MVP choice.
- No custom domain — production stays on `co-jemy.mediewilnp.workers.dev`.
- No password-reset / magic-link flows (not in FR-001/FR-002).
- No rework of `confirm-email.astro`'s DEV branching — its messages are correct for both environments.
- No automated e2e/smoke tests — testing strategy arrives with Module 3; verification here is a manual live checklist.
- No handling of Supabase email rate-limit errors in UI beyond the existing error redirect.

## Implementation Approach

Smallest-delta closure: one new API route following the exact conventions of its siblings in `src/pages/api/auth/`, one redirect fix, then move all remaining work to external-service configuration (Supabase dashboard, GitHub secrets) sequenced so this change's own merge to master doubles as the CI pipeline's live proof.

## Critical Implementation Details

- **Timing & lifecycle**: Phase 1 code must be deployed (Phase 3 merge) *before* a production confirmation link can work — but the Phase 2 template change is safe to make early because the old `{{ .ConfirmationURL }}` links simply stop being generated once the template changes; there is no state to migrate. Do Phase 2 after Phase 1 is reviewed but before the Phase 3 live test.
- **State sequencing**: the confirm route must build the Supabase client from the incoming request (`createClient(context.request.headers, context.cookies)`) so `verifyOtp` writes session cookies through Astro's cookie adapter. A bare `supabase-js` client would verify the token but drop the session.
- **Debug & observability**: if the live email doesn't arrive or the link 404s, check `wrangler tail` for the confirm-route hit and the Supabase dashboard's Auth logs for send failures; built-in SMTP rate-limiting is the most likely silent failure.

## Phase 1: Confirmation verify route + redirect fixes

### Overview

Add the server route that completes email confirmation and establishes the session; point sign-in success at the protected area.

### Changes Required:

#### 1. New confirmation route

**File**: `src/pages/api/auth/confirm.ts`

**Intent**: Complete email confirmation server-side. The emailed link (rewritten in Phase 2) targets this route with `token_hash` and `type` query params; verifying them signs the user in, closing the loop in one click.

**Contract**: `GET /api/auth/confirm?token_hash=<hash>&type=email`. Follow the sibling endpoints' shape (`signin.ts` / `signup.ts`): build the client with `createClient(context.request.headers, context.cookies)`, redirect to `/auth/signin?error=…` when the client is null, when `token_hash`/`type` are missing, or when `verifyOtp` returns an error (use a human-readable message like "Confirmation link is invalid or has expired"); on success redirect to `/dashboard`. `type` comes from the query string and is passed through to `verifyOtp` as an `EmailOtpType` (the template sends `type=email`).

#### 2. Sign-in redirect target

**File**: `src/pages/api/auth/signin.ts`

**Intent**: Land the user in the protected area after sign-in so the DoD loop ("sign in → reach protected area") is self-evident.

**Contract**: success redirect changes from `/` to `/dashboard` (line 19). No other behavior changes.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build passes: `npm run astro sync && npm run build`

#### Manual Verification:

- Local dev: signup still auto-confirms (local config unchanged) and sign-in now lands on `/dashboard`
- Local dev: `GET /api/auth/confirm` with a bogus `token_hash` redirects to `/auth/signin` with a readable error, never a 500
- Local dev: `GET /api/auth/confirm` with missing params redirects to `/auth/signin` with a readable error

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Supabase production wiring (human-only dashboard steps)

### Overview

Point the hosted Supabase project at production and switch the confirmation email to the `token_hash` template. All steps happen in the Supabase dashboard — the agent provides the checklist and verifies nothing in code changes.

### Changes Required:

#### 1. Site URL

**Where**: Supabase dashboard → Authentication → URL Configuration

**Intent**: Make `{{ .SiteURL }}` in email templates resolve to production so confirmation links land on the live Worker.

**Contract**: Site URL = `https://co-jemy.mediewilnp.workers.dev`. No redirect-allow-list entries needed (no `emailRedirectTo` in code).

#### 2. Confirm-signup email template

**Where**: Supabase dashboard → Authentication → Email Templates → Confirm signup

**Intent**: Route the confirmation click through the app's verify route instead of Supabase's hosted verify endpoint.

**Contract**: the link in the template becomes:

```html
<a href="{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=email">Confirm email address</a>
```

#### 3. Email confirmations enabled

**Where**: Supabase dashboard → Authentication → Sign In / Providers → Email

**Intent**: Ensure "Confirm email" is ON for the hosted project (it is the hosted default; verify it wasn't disabled). Built-in SMTP stays as the sender — no custom SMTP config.

### Success Criteria:

#### Manual Verification:

- Site URL shows the production workers.dev origin in the dashboard
- Confirm-signup template contains the `token_hash` link targeting `/api/auth/confirm`
- "Confirm email" toggle is ON for the email provider

**Implementation Note**: These are human-only steps (dashboard access). The live proof that they're correct is Phase 3's end-to-end test — don't burn rate-limited signup emails verifying this phase in isolation.

---

## Phase 3: CI-proven deploy + live verification

### Overview

Create the missing GitHub secret, let this change's own merge to master trigger `deploy.yml`, then walk the full auth loop on the live URL.

### Changes Required:

#### 1. GitHub Actions secrets (human-only)

**Where**: Cloudflare dashboard + GitHub repo → Settings → Secrets and variables → Actions

**Intent**: Give `deploy.yml` what it needs to ship. Per the deployment plan's access boundary, token creation is human-only.

**Contract**: `CLOUDFLARE_API_TOKEN` = a **scoped** Cloudflare token (Edit Workers permission only — no DNS/billing), stored as a GitHub Actions secret. Also confirm `SUPABASE_URL` and `SUPABASE_KEY` repo secrets exist (the build steps in `ci.yml:23-24` / `deploy.yml:27-29` consume them; check whether past Actions runs on master were green to know).

#### 2. Merge and deploy

**Intent**: Push/merge this change to `master`; `deploy.yml` runs lint + build + `wrangler deploy`. This merge IS the pipeline's live proof — no separate test deploy.

**Contract**: workflow run green end-to-end; the deploy step publishes with the existing Worker secrets untouched.

#### 3. Bookkeeping

**File**: `context/changes/production-auth-loop/change.md` + GitHub issue #2

**Intent**: Record closure. Note on the issue that the "commit the drafted CI workflow" DoD item was already satisfied before this change (workflows were committed earlier); tick the remaining items as they verify.

**Contract**: `change.md` status flips per the 10x workflow on completion; issue #2 checkboxes updated with a short comment.

### Success Criteria:

#### Automated Verification:

- Deploy workflow run is green: `gh run list --workflow=deploy.yml --limit 1`
- Production responds: `curl -s -o /dev/null -w "%{http_code}" https://co-jemy.mediewilnp.workers.dev/` returns 200

#### Manual Verification:

- Register on the live URL with a plus-addressed real email; confirmation email arrives (allow for built-in SMTP delay/rate limit)
- Clicking the emailed link lands **signed in** on `https://co-jemy.mediewilnp.workers.dev/dashboard`
- Sign out returns to the homepage; signing back in lands on `/dashboard`
- A wrong/expired confirmation link shows the readable error on `/auth/signin`

---

## Testing Strategy

### Unit Tests:

- None in this change — no test runner exists yet; testing strategy arrives with Module 3.

### Integration Tests:

- None automated; the merge-triggered deploy plus the live manual loop below is the integration test.

### Manual Testing Steps:

1. Locally: signup → auto-confirm → sign in → `/dashboard`; bogus/missing-param hits on `/api/auth/confirm` produce readable errors.
2. Live (after Phase 3 deploy): register with `youraddress+authloop1@gmail.com`, wait for the email, click the link, confirm you arrive signed in at `/dashboard`.
3. Live: sign out, sign in again with the same account, confirm `/dashboard`.
4. Live: re-click the already-used confirmation link — expect the readable error redirect, not a 500.
5. Budget: built-in SMTP allows only a few emails/hour — plan at most 2-3 registration attempts per session.

## Performance Considerations

None material — one additional lightweight route; `verifyOtp` is a single Supabase round-trip on a rarely-hit path.

## Migration Notes

No data migration. Existing unconfirmed test accounts (if any) predate the template change; re-register them rather than resurrecting old links. Rollback: revert the merge commit — `deploy.yml` will redeploy the previous state; dashboard settings can be reverted independently and harmlessly.

## References

- GitHub issue: https://github.com/KSchlagowski/Co_jemy/issues/2
- Roadmap slice: `context/foundation/roadmap.md` (S-01)
- Deployment plan (CI Phase 5, access boundary): `context/changes/deployment/deployment-plan.md`
- Sibling endpoint pattern: `src/pages/api/auth/signin.ts`, `src/pages/api/auth/signup.ts`
- Supabase SSR client: `src/lib/supabase.ts`
- Supabase docs pattern: guides/auth/passwords — "Define route for email OTP confirmation" + PKCE signup email template

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Confirmation verify route + redirect fixes

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — 7e459bc
- [x] 1.2 Build passes: `npm run astro sync && npm run build` — 7e459bc

#### Manual

- [x] 1.3 Local sign-in with an existing confirmed account lands on `/dashboard` (auto-confirm clause dropped: `.dev.vars` points dev at the hosted project, so `supabase/config.toml`'s `enable_confirmations = false` does not apply; real confirmation is covered by Phase 3) — 7e459bc
- [x] 1.4 Bogus `token_hash` on `/api/auth/confirm` redirects with readable error, never 500 — 7e459bc
- [x] 1.5 Missing params on `/api/auth/confirm` redirect with readable error — 7e459bc

### Phase 2: Supabase production wiring

#### Manual

- [x] 2.1 Site URL set to the production workers.dev origin (set to `https://co-jemy.mediewilnp.workers.dev/auth/callback`, not the bare origin: with the email template locked, `{{ .ConfirmationURL }}` redirects to Site URL, so Site URL *is* the callback target)
- [x] 2.2 Confirm-signup template uses the `token_hash` link to `/api/auth/confirm` (VOID — hosted Supabase gates template editing behind custom SMTP, which the plan ruled out under "What We're NOT Doing". Superseded by client-forwarded callback: new `src/pages/auth/callback.astro` + `src/pages/api/auth/callback.ts` handle the PKCE `?code=` and implicit-fragment cases. `confirm.ts` retained but unused)
- [x] 2.3 "Confirm email" toggle verified ON

### Phase 3: CI-proven deploy + live verification

#### Automated

- [ ] 3.1 Deploy workflow run green: `gh run list --workflow=deploy.yml --limit 1`
- [ ] 3.2 Production responds 200 on `/`

#### Manual

- [ ] 3.3 Live registration email arrives and link lands signed-in on `/dashboard`
- [ ] 3.4 Sign out → sign in again lands on `/dashboard`
- [ ] 3.5 Used/invalid confirmation link shows readable error
