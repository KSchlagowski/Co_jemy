# Review follow-ups — spoonacular-retrieval-spike impl review (2026-07-19)

Queued from `reviews/impl-review.md` triage. These are preconditions/notes for later changes, not open defects in the spike.

- **F5 (S-02 precondition)**: `toCandidate` in `src/lib/spoonacular.ts` blind-casts provider payload fields (`raw.id as number`, etc.). Before S-02's proposal logic consumes `RecipeCandidate` data, add validation/narrowing of the provider payload so malformed responses surface as a typed failure instead of propagating bad values.
