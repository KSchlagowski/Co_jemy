# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Guard tokens on public endpoints: fail closed + timing-safe compare

- **Context**: deea7fd:src/pages/api/spike/spoonacular.ts:18 — token guard on the temporary spike endpoint, live on the public workers.dev URL between deploy and deletion.
- **Problem**: The guard used a plain `!==` string comparison, which is not timing-safe. It did fail closed on unset/empty SPIKE_TOKEN so exploitability was marginal, but the pattern would be a real weakness on any longer-lived guarded endpoint.
- **Rule**: Any token/secret check on a publicly reachable endpoint must (1) fail closed when the expected secret is unset or empty, and (2) use a timing-safe comparison — on Cloudflare Workers, `crypto.subtle.timingSafeEqual` over equal-length encodings, never `===`/`!==`.
- **Applies to**: any `src/pages/api/**` endpoint guarded by a shared token or secret header; future spike/debug endpoints.
