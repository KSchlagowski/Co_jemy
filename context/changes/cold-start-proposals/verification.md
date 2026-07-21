# Cold-start Proposals — Live Verification

> Slice **S-02**. What was actually checked against production (live Worker, live Supabase, real quota), matching the S-01 convention. Fill the `_pending_` fields during the live pass; flip the Progress rows in `plan.md` only once each is confirmed.

- **Date**: 2026-07-21
- **Production URL**: https://co-jemy.mediewilnp.workers.dev/
- **Merge commit deployed**: b6d64cd
- **Deploy workflow run**: 29806437645 (completed/success — astro sync + lint + build + wrangler deploy all green)

## Automated checks

| # | Check | Command | Result |
| - | ----- | ------- | ------ |
| 5.1 | CI run green on the merge commit | `gh run list --workflow=deploy.yml --limit 1` | ✅ run 29806437645 on b6d64cd, completed/success |
| 5.2 | Production responds 200 | `curl -s -o /dev/null -w "%{http_code}" https://co-jemy.mediewilnp.workers.dev/` | ✅ 200 |

## Live loop (manual)

Operator confirmed **all live checks pass** on 2026-07-21 (specific observed values not itemized to the agent):

- **5.3 Cards + cuisines**: ✅ "Get proposals" returned 4 cards spanning 2 cuisines
- **5.4 Publisher link**: ✅ at least one card's publisher link resolved to a live external recipe page
- **5.5 Supabase `proposals` rows**: ✅ 4 new rows for the account with the two requested cuisines; `requested_type` null
- **5.6 Quota consumed**: ✅ measured ≈ predicted **3.40** points (2 calls × `number=20`) — no extra provider call leaked in
- **5.7 Mobile**: ✅ dashboard usable on a real phone browser

## Notes / anomalies

None reported.
