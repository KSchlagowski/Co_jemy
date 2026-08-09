/**
 * Client-side view of the ratings-page contracts, same single-declaration discipline
 * as `src/components/proposals/types.ts`: every shape is owned by the endpoint or lib
 * that produces it and re-exported type-only, so the imports are erased at compile
 * time and no server code reaches the client bundle.
 */
export type { RatedRecipe } from "@/lib/history";
export type { RatingVerdict, RatingDeleteResponse } from "@/pages/api/ratings";

/** The POST envelope, declared once in the proposals types and shared here. */
export type { RatingResponse } from "@/components/proposals/types";
