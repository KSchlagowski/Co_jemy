import { useRef, useState } from "react";
import { Sparkles, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RecipeCard } from "@/components/proposals/RecipeCard";
import { ProposalError } from "@/components/proposals/ProposalError";
import type { Proposal, ProposalMode, ProposalsResponse } from "@/components/proposals/types";

type Status = "idle" | "loading" | "loaded" | "error";

// Why this card is in the set (FR-008). Only meaningful on a personalized set — cold-start
// slots are positional, so the badges stay off until the envelope says `personalized`.
const SLOT_LABEL: Record<Proposal["slot"], string> = {
  1: "Recently liked",
  2: "Worth revisiting",
  3: "Matches your taste",
  4: "Something new",
};

export default function ProposalList() {
  const [status, setStatus] = useState<Status>("idle");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [mode, setMode] = useState<ProposalMode>("cold_start");
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
      setMode(data.mode);
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
  const personalized = mode === "personalized";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-3 text-center">
        {/* The starter-set line is a lie once a personalized set is on screen — the badges below
            are the payoff it promises, so the copy has to hand off to them. */}
        <p className="text-sm text-blue-100/60">
          {status === "loaded" && personalized
            ? "Shaped by what you've rated so far — keep rating and it keeps sharpening."
            : "Rate a few and your proposals start learning your taste. For now, here's a diverse starter set."}
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
              {personalized
                ? "Some proposals couldn't be personalized this time."
                : "Only one cuisine was available this time."}
            </p>
          )}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {proposals.map((proposal) => (
              <div key={proposal.id} className="relative">
                {personalized && (
                  <span className="absolute top-3 left-3 z-10 rounded-full border border-white/20 bg-black/60 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
                    {SLOT_LABEL[proposal.slot]}
                  </span>
                )}
                <RecipeCard proposal={proposal} initialVerdict={proposal.ratingVerdict} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
