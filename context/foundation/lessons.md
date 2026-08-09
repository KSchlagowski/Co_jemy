# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Guard tokens on public endpoints: fail closed + timing-safe compare

- **Context**: deea7fd:src/pages/api/spike/spoonacular.ts:18 — token guard on the temporary spike endpoint, live on the public workers.dev URL between deploy and deletion.
- **Problem**: The guard used a plain `!==` string comparison, which is not timing-safe. It did fail closed on unset/empty SPIKE_TOKEN so exploitability was marginal, but the pattern would be a real weakness on any longer-lived guarded endpoint.
- **Rule**: Any token/secret check on a publicly reachable endpoint must (1) fail closed when the expected secret is unset or empty, and (2) use a timing-safe comparison — on Cloudflare Workers, `crypto.subtle.timingSafeEqual` over equal-length encodings, never `===`/`!==`.
- **Applies to**: any `src/pages/api/**` endpoint guarded by a shared token or secret header; future spike/debug endpoints.

## Shared catalogue tables under anon-key RLS: unrestricted insert means first write wins

- **Context**: `cold-start-proposals` plan, Phase 1.2 — the `recipes` table grants `insert ... with check (true)` to `authenticated` so the app can upsert with the user's own session client and avoid a service-role key.
- **Problem**: Registration is open and the anon key is public, so any account holder can insert an arbitrary `spoonacular_id`/`title`/`image` straight through PostgREST. The app's later genuine upsert uses `ignoreDuplicates: true` and is silently discarded, and with no update policy nothing can repair the row. The spoofed content is then served to *other* users from the ratings-history view onward. Accepted for the MVP's flat-trust model; recorded because the shape, not the stakes, is the problem.
- **Rule**: A table written with the user's anon-key session but read by *other* users is a shared-trust surface. Before it becomes user-visible, either move its writes behind a service-role client or constrain them with a trigger/check that validates the row against the provider payload. `with check (true)` is only defensible while the table is write-only from the user's perspective.
- **Applies to**: `recipes` when S-03 starts rendering rows back to users; any future provider-derived catalogue shared across accounts.

## Enumerated filters over third-party prose are known-incomplete, and their gaps are silent

- **Context**: `src/lib/proposals.ts:34-43` — `NUTRITION_FIGURE` / `NUTRITION_CLAIM` / `PROVIDER_MENTION`, the patterns that cut Spoonacular's `summary` before any macro figure so the excerpt satisfies the PRD's no-macros non-goal.
- **Problem**: The patterns were enumerated from one day of sampled payloads (2026-07-20), not derived from a provider schema. They caught macro *figures* and two figure-free phrasings, but missed whole classes of health claim that carry no digit at all — "is high in protein", "a good option if you're following a gluten free diet", "super healthy". Nothing fails when a new phrasing appears: the excerpt simply renders the claim. Manual spot-checks pass because they sample the same payloads the patterns were written from, so the filter looks complete precisely when it is not.
- **Rule**: When a compliance or non-goal boundary is enforced by matching patterns against third-party free text, treat the pattern set as permanently incomplete. Say so in a comment at the definition, prefer over-cutting to under-cutting where the fallback degrades gracefully (here: a too-short excerpt returns `null` and the card still renders), and re-widen the set whenever new provider payloads are sampled. Never treat a passing manual spot-check as evidence the set is closed.
- **Applies to**: `sanitizeSummary` in `src/lib/proposals.ts`; any future filter that enforces FR-011, the no-macros non-goal, or attribution rules by pattern-matching provider prose.

## PostgREST reads are silently capped at max-rows — "unbounded" selects truncate without error

- **Context**: `src/lib/history.ts` — `getRecentLikes` / `getDislikedIds`, the S-05 history reads whose id sets double as the FR-009 dislike exclusion and the "liked never poses as new" pool filter.
- **Problem**: Supabase's PostgREST caps every response at its `max-rows` setting (default 1000) and reports no error when it does. A query written with no `.limit()` reads as "returns everything" but silently loses rows past the cap. Here the truncated set is an exclusion list, so past ~1000 ratings per user FR-009 — the PRD's one absolute rule — degrades invisibly; manual testing can never catch it because MVP cardinality sits far below the cap.
- **Rule**: Never treat a no-limit PostgREST select as complete. When a read feeds a correctness rule (exclusion, dedupe, budget), either page it, bound it with an explicit `.limit()` sized to the rule, or fetch with `count: 'exact'` and fail loudly when the count exceeds the returned rows. Code comments must state the cap rather than claim unboundedness.
- **Applies to**: all reads in `src/lib/history.ts`; any future PostgREST read whose completeness a product rule depends on.
