---
change_id: rate-recipe
title: Rate a proposed recipe with persistent 👍/👎
status: implementing
created: 2026-08-08
updated: 2026-08-08
archived_at: null
---

## Notes

s-03 from roadmap

- Planned 2026-08-08 (`plan.md` + `plan-brief.md`). Decisions: upsert re-rating (UPDATE policy, no delete); rate any known recipe (FK-only integrity); wait-for-server UI; unit tests here, real-RLS integration/E2E deferred to test-plan rollout Phase 3.
- **S-04 prerequisite (recorded here per plan):** harden `recipes` open insert policy (lessons.md lesson 2 — `with check (true)` first-write-wins spoofing) before S-04 renders recipes-table rows back to users. Deferred from this slice because S-03's UI renders live API data only.
