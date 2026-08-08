import { CircleAlert } from "lucide-react";

interface ProposalErrorProps {
  /** The machine `reason` from the endpoint envelope, `no_results` for an empty set, or null. */
  reason?: string | null;
}

// Each message must differ meaningfully: quota exhausted means *come back tomorrow* (retrying
// today is futile), provider errors mean *try again shortly*, misconfiguration means *this is
// our problem, not yours*. No retry button — retrying a metered API on a button burns quota.
const MESSAGE_BY_REASON: Record<string, string> = {
  quota_exhausted: "You've reached today's recipe limit. Come back tomorrow for a fresh set.",
  http_error: "We couldn't reach the recipe service just now. Try again in a moment.",
  network_error: "We couldn't reach the recipe service just now. Try again in a moment.",
  not_configured: "Something's misconfigured on our side — this one's on us, not you. Please try again later.",
  service_unavailable: "Something's misconfigured on our side — this one's on us, not you. Please try again later.",
  unauthenticated: "Your session has expired. Please sign in again.",
  no_results: "We couldn't find recipes this time. Try again shortly.",
  internal_error: "Something went wrong on our side. Please try again in a moment.",
};

export function ProposalError({ reason }: ProposalErrorProps) {
  if (!reason) return null;

  const message = MESSAGE_BY_REASON[reason] ?? "Something went wrong fetching proposals. Try again shortly.";

  return (
    <p className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-900/30 px-3 py-2 text-sm text-red-300">
      <CircleAlert className="size-4 shrink-0" />
      {message}
    </p>
  );
}
