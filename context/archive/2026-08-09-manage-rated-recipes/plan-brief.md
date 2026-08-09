# Manage Rated Recipes (S-04) — Plan Brief

> Full plan: `context/changes/manage-rated-recipes/plan.md`
> Research: `context/changes/manage-rated-recipes/research.md`

## What & Why

Build the rating-management surface: a page listing everything the user has rated (FR-005), in-place rating flips (FR-006), and rating deletion that returns a recipe to unrated status (FR-007). This closes the PRD's core feedback loop — the list is where users see and control the taste profile that drives their proposals — and unblocks the E2E test plan, which cannot clean up rating rows until DELETE exists.

## Starting Point

S-03 shipped the ratings table and `POST /api/ratings` (an upsert — so flipping already works server-side), but deliberately deferred the delete grant/policy to S-04. The `recipes` table stores the FR-011 three-field set (id, title, image) with an open insert policy that any account can abuse to pre-spoof rows — acceptable while rows were write-only, but S-04's list is the first time they render back to users, so the deferred hardening (lessons.md lesson 2) fires now.

## Desired End State

A logged-in user opens `/dashboard/ratings`, sees every rated recipe (newest first, title + image + verdict), flips ratings in place, and deletes one via a two-step inline confirm — after which that recipe can be proposed again. Recipe catalogue writes go through a server-only service-role client; regular users can no longer insert into `recipes`. The page costs zero Spoonacular quota.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| FR-010 attribution on list | No credit/link on rows | The management list is a non-proposal surface; storing `sourceName`/`sourceUrl` is forbidden (FR-011) and live re-fetch costs 1 pt/recipe | Plan (user) |
| `recipes` hardening | Service-role writes + revoke `authenticated` insert | Closes the spoof channel at the source with a repairing upsert; trigger-based validation can't verify against the provider | Plan (user) |
| Delete UX | Inline two-step confirm | Prevents accidental loss of guardrail data without inventing a dialog primitive | Plan (user) |
| 👎-flip warning | Silent flip | Consistent with proposal cards; FR-007 delete is the documented escape | Plan (user) |
| Route | `/dashboard/ratings` | Inherits middleware protection via prefix match, zero changes | Plan |
| List data path | SSR in page frontmatter, no GET endpoint | One embedded select via the existing FK; island updates state locally on `ok: true` | Plan |
| Delete semantics | Idempotent 200 (`deleted: boolean`) | Zero-row delete still satisfies the user's intent; race/double-tap safe | Research → Plan |
| List bounding | `.limit(100)` + documented cap | Lesson 4: display list, not a correctness rule — a bound beats pagination at MVP cardinality | Research → Plan |

## Scope

**In scope:** delete migration (grant + policy), `recipes` insert revoke, service-role client module + env secret, repairing `persist()` upsert, `DELETE /api/ratings`, `getRatedRecipes` read, ratings page + island (flip, two-step delete, empty state), `RatingButton` extraction, dashboard↔ratings links, unit tests.

**Out of scope:** publisher credit/links on the list, pagination, undo/toast/dialog primitives, 👎-flip warnings, Topbar redesign, GET endpoint, the S-05 F6 anon-grant-revoke migration, E2E tests (unblocked, not written here).

## Architecture / Approach

The list is served entirely from local data: one PostgREST embedded select (`ratings → recipes(title, image)`) over the existing FK, server-rendered in the Astro frontmatter and passed as props to a `client:load` island. Mutations reuse `POST /api/ratings` (flip) and the new `DELETE` handler in the same route file, both non-optimistic. Hardening splits the write paths: user-scoped `proposals`/`ratings` rows stay on the session client under RLS; the shared `recipes` catalogue moves to a service-role client with a repairing upsert.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Hardening + Schema | Service-role write path, migration (delete grant + insert revoke) | Deploy ordering: revoke before code deploy breaks recipe persistence |
| 2. API + Data Read | `DELETE /api/ratings`, `getRatedRecipes`, wire types, tests | First non-POST route — delete must be session-scoped and idempotent |
| 3. UI | `/dashboard/ratings` page + island, flip/delete UX, empty state, nav | React-compiler constraints (no effects); two-step confirm without a dialog primitive |

**Prerequisites:** Supabase service_role key in hand; ability to run `wrangler secret put` and `npx supabase db push --linked` (human-only steps, strictly ordered: secret → deploy → push).
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- Assumes the service_role key can be provisioned on the Worker without plan changes (it's a standard Supabase key + Cloudflare secret).
- The no-credit-on-list ruling is a licence reading, not provider-confirmed; if it proves wrong, the on-demand live-fetch option is the fallback (1 pt per user action).
- Phase 1's mid-sequence window (code deployed, migration not yet pushed) is safe by design (admin client bypasses RLS), but the reverse order is not — the plan flags this as the phase gate.

## Success Criteria (Summary)

- The full manage loop works and persists: rate → list → flip → delete → recipe proposable again (FR-009 reset observed).
- Anon-key inserts into `recipes` are rejected while proposals still persist (`recorded: true`) via the service-role path.
- Rating management costs zero Spoonacular points end to end.
