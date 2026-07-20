---
change_id: cold-start-proposals
title: Cold-start proposals from the Spoonacular API
status: implementing
created: 2026-07-20
updated: 2026-07-20
archived_at: null
---

## Notes

Roadmap slice **S-02** (north star) — see `context/foundation/roadmap.md`.

- **Outcome:** a logged-in user with no ratings can request proposals and see 4 real recipes from at least 2 different cuisines, each with a title, brief description, and working external link; a dead link is signaled instead of failing silently; proposed recipes are recorded so they can be rated later.
- **PRD refs:** US-02, FR-003, FR-008 (cold-start behavior), FR-010, FR-011, NFR (dead-link, mobile)
- **Prerequisites:** F-01 (`spoonacular-retrieval-spike`) — done, archived at `context/archive/2026-07-16-spoonacular-retrieval-spike/`
- **Backlog:** [#3](https://github.com/KSchlagowski/Co_jemy/issues/3)
- **Plan review triaged (2026-07-20):** all 6 findings resolved — F1 offset capped to 0–50, F2 quota figures recomputed to ≈3.40 pts/set, F3 `degraded` flag added to the envelope, F4 `db push` moved to human-run Manual Verification, F5 accepted for MVP and recorded in `context/foundation/lessons.md`, F6 "up to 4" survivor behavior specified. Report: `reviews/plan-review.md`.
- **Decision carried in from the roadmap (2026-07-18):** the first migration must record the app's own request-side facets (requested `cuisine`, requested meal `type` if sent) plus a proposed-at timestamp alongside `spoonacular_id` — otherwise S-05 has to re-fetch every liked recipe to infer a taste profile, which the free quota will not sustain. Do **not** persist the response's `dishTypes[]` / `cuisines[]` (provider-returned fields, restricted by FR-011 including derived copies).
