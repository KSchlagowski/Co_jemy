---
change_id: personalized-proposal-slots
title: Personalized 4-slot proposals (S-05)
status: archived
created: 2026-08-08
updated: 2026-08-09
archived_at: 2026-08-09T12:42:16Z
---

## Notes

Roadmap **S-05** — see `context/foundation/roadmap.md` §Slices. A user with rating
history gets proposals observably shaped by it:

- **Slot 1:** recently liked recipe
- **Slot 2:** liked recipe not proposed in ≥2 weeks
- **Slot 3:** new recipe matching the inferred taste profile
- **Slot 4:** random discovery
- 👎-rated recipes permanently excluded (FR-009); slot logic activates
  progressively as ratings accumulate (cold-start fallback stays in place).

- **PRD refs:** US-01, FR-008, FR-009
- **Prerequisites:** S-02 (`cold-start-proposals`, done) + S-03 (`rate-recipe`, done)
- **Parallel with:** S-04 (`manage-rated-recipes`)
- **Open unknown (roadmap):** what rating-history threshold activates each slot's
  logic — a default can ship and be tuned.
- **Constraint (roadmap pivot note):** the taste profile must be inferred from
  cuisines the app *requested and recorded*, never from the provider-returned
  `cuisines[]` array (derived field, often empty, and FR-011-restricted).
