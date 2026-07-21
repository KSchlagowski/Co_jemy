/**
 * Client-side mirror of the `/api/proposals` envelope. Kept in sync with `ProposalPayload`
 * and the response shape in `src/pages/api/proposals.ts` — the excerpt arrives already
 * sanitized to plain text, so no HTML ever crosses to the client.
 */
export interface Proposal {
  id: number;
  title: string;
  image: string | null;
  excerpt: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  spoonacularSourceUrl: string | null;
  requestedCuisine: string;
}

export type ProposalsResponse =
  | { ok: true; proposals: Proposal[]; recorded: boolean; degraded: boolean }
  | { ok: false; reason: string };
