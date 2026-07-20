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
