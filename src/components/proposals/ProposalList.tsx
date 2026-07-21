import { useRef, useState } from "react";
import { Sparkles, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RecipeCard } from "@/components/proposals/RecipeCard";
import { ProposalError } from "@/components/proposals/ProposalError";
import type { Proposal, ProposalsResponse } from "@/components/proposals/types";

type Status = "idle" | "loading" | "loaded" | "error";

export default function ProposalList() {
  const [status, setStatus] = useState<Status>("idle");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [errorReason, setErrorReason] = useState<string | null>(null);
  // Each request that reaches the endpoint spends real quota — a ref guard blocks a second
  // in-flight call even between the click and the disabled-button re-render.
  const inFlight = useRef(false);

  async function getProposals() {
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus("loading");
    setErrorReason(null);

    try {
      const response = await fetch("/api/proposals", { method: "POST" });
      const data = (await response.json()) as ProposalsResponse;

      if (!data.ok) {
        setErrorReason(data.reason);
        setStatus("error");
        return;
      }

      // "Up to 4": an ok response with an empty array is a provider miss, not a blank grid.
      if (data.proposals.length === 0) {
        setErrorReason("no_results");
        setStatus("error");
        return;
      }

      setProposals(data.proposals);
      setDegraded(data.degraded);
      setStatus("loaded");
    } catch {
      setErrorReason("network_error");
      setStatus("error");
    } finally {
      inFlight.current = false;
    }
  }

  const loading = status === "loading";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-blue-100/60">
          Rate a few and your proposals start learning your taste. For now, here&apos;s a diverse starter set.
        </p>
        <Button
          type="button"
          onClick={getProposals}
          disabled={loading}
          className="rounded-lg bg-purple-600 px-5 py-2 font-medium text-white transition-colors hover:bg-purple-500"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Loading…
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Sparkles className="size-4" />
              Get proposals
            </span>
          )}
        </Button>
      </div>

      {status === "error" && <ProposalError reason={errorReason} />}

      {status === "loaded" && (
        <div className="flex flex-col gap-4">
          {degraded && (
            <p className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-blue-100/60">
              <Info className="size-4 shrink-0" />
              Only one cuisine was available this time.
            </p>
          )}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {proposals.map((proposal) => (
              <RecipeCard key={proposal.id} proposal={proposal} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
