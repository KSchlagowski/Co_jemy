/**
 * Client-side view of the `/api/proposals` envelope.
 *
 * `Proposal` is a type-only re-export of the endpoint's own `ProposalPayload`, so the wire
 * contract has exactly one declaration — adding a field server-side is a type error here
 * rather than a silent drift. The import is erased at compile time; no server code reaches
 * the client bundle. The excerpt arrives already sanitized to plain text, so no HTML crosses.
 */
export type { ProposalPayload as Proposal } from "@/pages/api/proposals";

import type { ProposalPayload } from "@/pages/api/proposals";

export type ProposalsResponse =
  | { ok: true; proposals: ProposalPayload[]; recorded: boolean; degraded: boolean }
  | { ok: false; reason: string };

/**
 * Client-side view of the `/api/ratings` envelope, same single-declaration discipline:
 * the verdict union is the endpoint's own type, erased at compile time.
 */
export type { RatingVerdict } from "@/pages/api/ratings";

import type { RatingVerdict } from "@/pages/api/ratings";

export type RatingResponse = { ok: true; verdict: RatingVerdict } | { ok: false; reason: string };
