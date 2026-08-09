import { useRef, useState } from "react";
import { UtensilsCrossed, ExternalLink, ThumbsUp, ThumbsDown, CircleAlert } from "lucide-react";
import { RatingButton } from "@/components/proposals/RatingButton";
import { safeUrl } from "@/lib/safe-url";
import type { Proposal, RatingResponse, RatingVerdict } from "@/components/proposals/types";

interface RecipeCardProps {
  proposal: Proposal;
  /** Stored verdict from the set's payload — pre-selects 👍 on a slot-1/2 re-proposal. */
  initialVerdict: RatingVerdict | null;
}

// Reason→copy mapping in the ProposalError.tsx style; unknown reasons fall back to the
// retryable message — a rating tap is cheap to repeat (no quota), unlike a proposal fetch.
const RATING_RETRY_MESSAGE = "We couldn't save your rating. Try again in a moment.";
const RATING_MESSAGE_BY_REASON: Record<string, string> = {
  unauthenticated: "Your session has expired. Please sign in again.",
  unknown_recipe: "We couldn't match this recipe. Request a fresh set and rate it there.",
  service_unavailable: "Something's misconfigured on our side — this one's on us, not you. Please try again later.",
  write_failed: RATING_RETRY_MESSAGE,
};

export function RecipeCard({ proposal, initialVerdict }: RecipeCardProps) {
  const [imageFailed, setImageFailed] = useState(false);

  // No optimistic selection: `verdict` only ever holds a server-confirmed value — either the
  // stored verdict the endpoint hydrated onto this slot, or the one a 200 just confirmed (that
  // 200 is what makes "persisted" true — PRD §Guardrails). The card can never show a rating
  // that would vanish on the next session. Seeded, not synced: if a card survives into the next
  // set (same recipe id → same key), its in-session verdict is at least as fresh as the payload,
  // so there is nothing to reconcile and no effect to write.
  const [verdict, setVerdict] = useState<RatingVerdict | null>(initialVerdict);
  const [ratingPending, setRatingPending] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);
  // `disabled` only lands after the re-render — the same gap ProposalList's fetch guard
  // covers. Without it a fast second tap fires a concurrent POST and the last-settled
  // response wins, which is not necessarily the last-sent intent.
  const ratingInFlight = useRef(false);

  async function rate(next: RatingVerdict) {
    if (ratingInFlight.current) {
      return;
    }
    ratingInFlight.current = true;
    setRatingPending(true);
    setRatingError(null);
    try {
      const res = await fetch("/api/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spoonacularId: proposal.id, verdict: next }),
      });
      const data = (await res.json()) as RatingResponse;
      if (data.ok) {
        setVerdict(data.verdict);
      } else {
        setRatingError(RATING_MESSAGE_BY_REASON[data.reason] ?? RATING_RETRY_MESSAGE);
      }
    } catch {
      setRatingError(RATING_RETRY_MESSAGE);
    } finally {
      ratingInFlight.current = false;
      setRatingPending(false);
    }
  }

  // FR-010: the primary link targets the publisher; `spoonacularSourceUrl` is a fallback only
  // when the publisher link is absent. The credit still renders when neither exists — and when
  // the provider omits `sourceName`, the publisher's hostname is attribution we can derive.
  const source = safeUrl(proposal.sourceUrl);
  const link = source ?? safeUrl(proposal.spoonacularSourceUrl);
  const credit = proposal.sourceName ?? source?.hostname.replace(/^www\./, "") ?? null;
  const imageSrc = safeUrl(proposal.image)?.href ?? null;
  const showImage = imageSrc && !imageFailed;

  // `h-full` on the article: the slot badge wraps each card in a relative div, so the grid
  // stretches that wrapper now — the card has to claim its height to keep rows equal.
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur-xl">
      <div className="relative aspect-[4/3] w-full bg-gradient-to-br from-purple-500/20 to-blue-500/20">
        {showImage ? (
          <img
            src={imageSrc}
            alt={proposal.title}
            loading="lazy"
            className="size-full object-cover"
            onError={() => {
              setImageFailed(true);
            }}
          />
        ) : (
          <div className="flex size-full items-center justify-center text-white/30">
            <UtensilsCrossed className="size-10" />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="text-base leading-snug font-semibold text-white">{proposal.title}</h3>

        {proposal.excerpt && <p className="text-sm leading-relaxed text-blue-100/60">{proposal.excerpt}</p>}

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          {credit && <span className="truncate text-xs text-blue-100/50">by {credit}</span>}
          {link && (
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-purple-300 transition-colors hover:text-purple-200"
            >
              View recipe
              <ExternalLink className="size-3" />
            </a>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-white/10 pt-3">
          <RatingButton
            label="Rate like"
            active={verdict === "like"}
            disabled={ratingPending}
            onClick={() => void rate("like")}
          >
            <ThumbsUp className="size-4" />
          </RatingButton>
          <RatingButton
            label="Rate dislike"
            active={verdict === "dislike"}
            disabled={ratingPending}
            onClick={() => void rate("dislike")}
          >
            <ThumbsDown className="size-4" />
          </RatingButton>
        </div>

        {ratingError && (
          <p className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-900/30 px-3 py-2 text-xs text-red-300">
            <CircleAlert className="size-4 shrink-0" />
            {ratingError}
          </p>
        )}
      </div>
    </article>
  );
}
