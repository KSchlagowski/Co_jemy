import { useRef, useState } from "react";
import { UtensilsCrossed, ThumbsUp, ThumbsDown, Trash2, CircleAlert } from "lucide-react";
import { RatingButton } from "@/components/proposals/RatingButton";
import type { RatedRecipe, RatingDeleteResponse, RatingResponse, RatingVerdict } from "@/components/ratings/types";

interface RatedRecipesListProps {
  /** SSR-fetched rows, newest first — the island seeds state from them and never refetches. */
  initialRatings: RatedRecipe[];
  /** True when the frontmatter read threw; renders the inline error instead of the list. */
  loadFailed?: boolean;
}

// Same reason→copy posture as RecipeCard: mutations are cheap to repeat (no quota),
// unknown reasons fall back to the retryable message.
const RETRY_MESSAGE = "That didn't save. Try again in a moment.";
const MESSAGE_BY_REASON: Record<string, string> = {
  unauthenticated: "Your session has expired. Please sign in again.",
  unknown_recipe: "We couldn't match this recipe anymore.",
  service_unavailable: "Something's misconfigured on our side — this one's on us, not you. Please try again later.",
  write_failed: RETRY_MESSAGE,
};

export default function RatedRecipesList({ initialRatings, loadFailed = false }: RatedRecipesListProps) {
  // Seeded from SSR, mutated locally only after a server 200 — the list never shows
  // a state the DB hasn't confirmed (PRD §Guardrails), and there is no effect to sync.
  const [ratings, setRatings] = useState<RatedRecipe[]>(initialRatings);

  if (loadFailed) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-900/30 px-3 py-2 text-sm text-red-300">
        <CircleAlert className="size-4 shrink-0" />
        We couldn&apos;t load your rated recipes. Refresh the page to try again.
      </p>
    );
  }

  if (ratings.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
        <p className="text-blue-100/80">Nothing rated yet — and that&apos;s exactly where everyone starts.</p>
        <p className="mt-2 text-sm text-blue-100/60">
          Every 👍 or 👎 teaches your proposals what you actually want to cook.
        </p>
        <a
          href="/dashboard"
          className="mt-4 inline-block text-sm font-medium text-purple-300 transition-colors hover:text-purple-200"
        >
          Get proposals on the dashboard →
        </a>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {ratings.map((rating) => (
        <RatedRecipeCard
          key={rating.spoonacularId}
          rating={rating}
          onFlipped={(verdict) => {
            setRatings((rows) =>
              rows.map((row) => (row.spoonacularId === rating.spoonacularId ? { ...row, verdict } : row)),
            );
          }}
          onDeleted={() => {
            setRatings((rows) => rows.filter((row) => row.spoonacularId !== rating.spoonacularId));
          }}
        />
      ))}
    </ul>
  );
}

interface RatedRecipeCardProps {
  rating: RatedRecipe;
  onFlipped: (verdict: RatingVerdict) => void;
  onDeleted: () => void;
}

function RatedRecipeCard({ rating, onFlipped, onDeleted }: RatedRecipeCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Two-step delete: first tap arms, second tap fires; `onBlur` disarms — the
  // zero-effect, zero-timer reset (react-compiler friendly, no cleanup to leak).
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Same gap RecipeCard guards: `disabled` lands only after the re-render, so a fast
  // second tap could fire a concurrent request without the ref.
  const inFlight = useRef(false);

  async function flip(next: RatingVerdict) {
    if (inFlight.current || next === rating.verdict) {
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spoonacularId: rating.spoonacularId, verdict: next }),
      });
      const data = (await res.json()) as RatingResponse;
      if (data.ok) {
        // Non-optimistic: the row flips only on the confirmed verdict. Silent on 👎 by
        // decision — FR-007 delete is the documented escape hatch.
        onFlipped(data.verdict);
      } else {
        setError(MESSAGE_BY_REASON[data.reason] ?? RETRY_MESSAGE);
      }
    } catch {
      setError(RETRY_MESSAGE);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  async function deleteRating() {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/ratings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spoonacularId: rating.spoonacularId }),
      });
      const data = (await res.json()) as RatingDeleteResponse;
      if (data.ok) {
        // `deleted: false` (already gone) still honors the intent — remove the row either way.
        onDeleted();
      } else {
        setConfirmingDelete(false);
        setError(MESSAGE_BY_REASON[data.reason] ?? RETRY_MESSAGE);
      }
    } catch {
      setConfirmingDelete(false);
      setError(RETRY_MESSAGE);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const showImage = rating.image && !imageFailed;

  return (
    <li className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur-xl">
      <div className="flex items-center gap-4 p-3 sm:p-4">
        <div className="relative aspect-[4/3] w-24 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 sm:w-32">
          {showImage ? (
            <img
              src={rating.image ?? undefined}
              alt={rating.title}
              loading="lazy"
              className="size-full object-cover"
              onError={() => {
                setImageFailed(true);
              }}
            />
          ) : (
            <div className="flex size-full items-center justify-center text-white/30">
              <UtensilsCrossed className="size-8" />
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2 text-left">
          <h3 className="text-sm leading-snug font-semibold text-white sm:text-base">{rating.title}</h3>

          <div className="flex flex-wrap items-center gap-2">
            <RatingButton
              label="Rate like"
              active={rating.verdict === "like"}
              disabled={pending}
              onClick={() => void flip("like")}
            >
              <ThumbsUp className="size-4" />
            </RatingButton>
            <RatingButton
              label="Rate dislike"
              active={rating.verdict === "dislike"}
              disabled={pending}
              onClick={() => void flip("dislike")}
            >
              <ThumbsDown className="size-4" />
            </RatingButton>

            {confirmingDelete ? (
              <button
                type="button"
                aria-label="Confirm delete rating"
                disabled={pending}
                onClick={() => void deleteRating()}
                onBlur={() => {
                  setConfirmingDelete(false);
                }}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-red-500/50 bg-red-900/40 px-2.5 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-900/60 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="size-4" />
                Confirm delete?
              </button>
            ) : (
              <button
                type="button"
                aria-label="Delete rating"
                disabled={pending}
                onClick={() => {
                  setConfirmingDelete(true);
                }}
                className="ml-auto inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 p-2 text-blue-100/60 transition-colors hover:bg-white/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>

          {error && (
            <p className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-900/30 px-3 py-2 text-xs text-red-300">
              <CircleAlert className="size-4 shrink-0" />
              {error}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}
