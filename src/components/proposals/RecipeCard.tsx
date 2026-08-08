import { useState } from "react";
import { UtensilsCrossed, ExternalLink } from "lucide-react";
import type { Proposal } from "@/components/proposals/types";

interface RecipeCardProps {
  proposal: Proposal;
}

// `sourceUrl` is publisher-supplied data relayed by the provider — the one place in this
// slice where untrusted remote input becomes an executable-capable attribute. Anything that
// is not plain http(s) is discarded; the card already renders fine without a link.
function safeUrl(url: string | null): URL | null {
  if (!url) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
}

export function RecipeCard({ proposal }: RecipeCardProps) {
  const [imageFailed, setImageFailed] = useState(false);

  // FR-010: the primary link targets the publisher; `spoonacularSourceUrl` is a fallback only
  // when the publisher link is absent. The credit still renders when neither exists — and when
  // the provider omits `sourceName`, the publisher's hostname is attribution we can derive.
  const source = safeUrl(proposal.sourceUrl);
  const link = source ?? safeUrl(proposal.spoonacularSourceUrl);
  const credit = proposal.sourceName ?? source?.hostname.replace(/^www\./, "") ?? null;
  const showImage = proposal.image && !imageFailed;

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur-xl">
      <div className="relative aspect-[4/3] w-full bg-gradient-to-br from-purple-500/20 to-blue-500/20">
        {showImage ? (
          <img
            src={proposal.image ?? undefined}
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
      </div>
    </article>
  );
}
