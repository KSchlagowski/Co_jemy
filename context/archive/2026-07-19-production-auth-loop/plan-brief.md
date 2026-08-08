# Production Auth Loop (S-01) — Plan Brief

> Full plan: `context/changes/production-auth-loop/plan.md`

## What & Why

Close roadmap slice S-01: a real user can register on the live URL, get a confirmation email that lands back on the production domain, click it and arrive signed in at the protected area, sign out, and sign in again. Until this lands, no real account can complete registration in production — and every later slice's live verification depends on working accounts. (PRD FR-001, FR-002; issue #2.)

## Starting Point

The auth scaffold (signin/signup/signout endpoints, `/dashboard` guard, Supabase SSR client) is built and deployed to `co-jemy.mediewilnp.workers.dev`, but the confirmation loop is open: `signUp` sends no redirect target, **no route in the app can complete a confirmation click**, and the hosted Supabase project still points at localhost. The CI workflows (`ci.yml`, `deploy.yml`) turned out to be already committed — the issue's "commit the drafted workflow" item is stale; what's missing is the `CLOUDFLARE_API_TOKEN` GitHub secret and a real merge-triggered deploy.

## Desired End State

Clicking the production confirmation email verifies the token server-side and drops the user, already signed in, onto `/dashboard`. Sign-in also lands on `/dashboard`. The change itself ships through `deploy.yml` on merge to master, proving the CI pipeline, and the whole loop is walked live.

## Key Decisions Made

| Decision                  | Choice                                          | Why (1 sentence)                                                                 |
| ------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| Confirmation completion   | `token_hash` verify route (`/api/auth/confirm`) | Canonical Supabase SSR pattern — deterministic, testable in-repo, lands signed-in. |
| CI pipeline proof         | In scope                                        | The merge you'd do anyway doubles as the pipeline's live test; closes issue #2 fully. |
| Email delivery            | Supabase built-in SMTP                          | Zero setup, fine for a solo-MVP trickle; rate limit only constrains testing.      |
| Post-auth destination     | `/dashboard`                                    | The DoD is "sign in → reach protected area" — land there directly.                |
| `emailRedirectTo`         | Not used                                        | The email template's `{{ .SiteURL }}` drives the link; no allow-list needed.      |

## Scope

**In scope:** new `GET /api/auth/confirm` route (verifyOtp → session → `/dashboard`); sign-in redirect fix; Supabase dashboard wiring (Site URL, token_hash email template, confirmations on); `CLOUDFLARE_API_TOKEN` GitHub secret; merge-triggered deploy; live end-to-end verification.

**Out of scope:** custom SMTP, custom domain, password reset / magic links, automated tests (Module 3), `confirm-email.astro` rework, rate-limit UI handling.

## Architecture / Approach

Smallest-delta closure. One new API route copies the exact shape of its siblings in `src/pages/api/auth/` and uses the existing SSR client so `verifyOtp` writes session cookies through Astro's cookie adapter. Everything else is external configuration (Supabase dashboard, GitHub secrets), sequenced so the change's own merge to master is the CI proof.

## Phases at a Glance

| Phase                                   | What it delivers                                            | Key risk                                                            |
| --------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| 1. Verify route + redirect fixes        | `/api/auth/confirm` completes confirmation; sign-in → `/dashboard` | Session cookies dropped if the client isn't built from the request  |
| 2. Supabase production wiring (human)   | Site URL + token_hash email template on the hosted project  | Dashboard config drift is invisible to the repo                     |
| 3. CI-proven deploy + live verification | Green `deploy.yml` run and a walked live auth loop          | Built-in SMTP rate limit (~few emails/hour) can stall live testing  |

**Prerequisites:** Supabase dashboard access; Cloudflare dashboard access to mint the scoped API token; GitHub repo admin for secrets.
**Estimated effort:** ~1-2 sessions across 3 phases (Phase 1 is the only code; 2 and 3 are mostly checklists and waiting on email).

## Open Risks & Assumptions

- Assumes `SUPABASE_URL`/`SUPABASE_KEY` GitHub repo secrets exist (CI build steps consume them) — verify via past Actions runs before merging.
- Built-in SMTP deliverability/delay is untested; if emails don't arrive, check Supabase Auth logs before suspecting the code.
- The production hostname lives only in the Supabase dashboard's Site URL — a future custom domain requires updating it there.

## Success Criteria (Summary)

- Register → email → click → **signed in** on `/dashboard`, all on the live URL; sign out and sign back in works.
- `deploy.yml` run for this change's merge is green — CI auto-deploy is proven.
- Invalid/expired confirmation links produce a readable error, never a 500.
