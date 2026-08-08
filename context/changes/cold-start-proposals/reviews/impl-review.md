<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Cold-start Proposals

- **Plan**: `context/changes/cold-start-proposals/plan.md`
- **Scope**: Full plan — Phases 1–5 of 5 (all Progress boxes `[x]`)
- **Date**: 2026-08-08
- **Verdict**: NEEDS ATTENTION → **all findings resolved in triage (2026-08-08)**
- **Findings**: 0 critical, 4 warnings, 5 observations — 9 fixed, 0 skipped, 1 also recorded as a lesson
- **Commit range**: `1a6390e..5d761ac`
- **Post-triage verification**: `npm run lint` exit 0 repo-wide · `npm run build` green · sanitizer re-checked against 7 sample summaries · client bundle confirmed free of server code

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Verification evidence

| Check | Command | Result |
|---|---|---|
| Type check / build | `npm run astro sync && npm run build` | ✅ pass — server built in 17.57s, no type errors |
| Lint (change's files) | `npx eslint src/lib/proposals.ts src/lib/spoonacular.ts src/pages/api/proposals.ts src/components/proposals src/pages/dashboard.astro` | ✅ pass — 0 problems |
| Lint (repo-wide, as CI runs it) | `npm run lint` | ❌ fail — 1 error in `.claude/hooks/post-edit.mjs` (introduced by `c52264a`, not this slice). See F2 |
| CSRF posture on the new POST endpoint | Astro `security.checkOrigin` default | ✅ defaults to `true` (`node_modules/astro/dist/core/config/schemas/base.js:52`); no override in `astro.config.mjs` |
| Manual criteria (1.3–1.7, 2.3–2.5, 3.3–3.7, 4.3–4.8, 5.3–5.7) | operator-run | ✅ recorded in `verification.md` (2026-07-21) with CI run 29806437645 and measured ≈3.40 quota points |

All plan contracts were implemented as written. Notably correct against the plan's harder requirements:
`toCandidate` narrowing + null-filtering in both `extract` callbacks; `(select auth.uid())` subquery form
in both `proposals` policies; only the three permitted provider fields in `recipes` (no `summary`,
`cuisines`, `dish_types`, ingredients, instructions, nutrition); `degraded` keyed to **cuisine coverage
of the assembled set** rather than call failure; write-then-respond with `recorded: false` on write
failure; ref-based double-submit guard; `sourceUrl` primary with `spoonacularSourceUrl` fallback only.

## Findings

### F1 — A card with no `sourceName` renders no publisher credit at all

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/proposals/RecipeCard.tsx:43
- **Detail**: The credit is rendered as `{proposal.sourceName && <span>by {proposal.sourceName}</span>}`. `sourceName` is typed `string | null` (`src/lib/spoonacular.ts:11`) and `toCandidate` coerces a missing field to `null` (`:68`), so a null value produces a card with a working "View recipe" link and **no publisher credit**. FR-010 is licence-binding, not cosmetic — the plan's own contract only closed the mirror case ("the `sourceName` credit is displayed even when neither link is available") and left the name-missing case open.
- **Fix A ⭐ Recommended**: Fall back to the `sourceUrl` hostname when `sourceName` is null, and render that as the credit.
  - Strength: Always produces a visible, accurate attribution from data already on the card; a few lines in `RecipeCard.tsx`, no server or schema change.
  - Tradeoff: The credit reads as `allrecipes.com` rather than `Allrecipes`; slightly less polished than the provider's own name.
  - Confidence: MED — the fix is trivially correct, but I have not sampled live payloads to confirm how often `sourceName` is actually null on `complexSearch` with `addRecipeInformation=true`.
  - Blind spot: Unverified real-world frequency; if it never happens live this is dead defensive code.
- **Fix B**: Drop the whole card server-side when `sourceName` is null, in `buildColdStartSet`.
  - Strength: Guarantees no un-credited recipe is ever rendered — the strictest reading of FR-010.
  - Tradeoff: Shrinks sets on a quota point already spent; conflicts with the "return whatever survives" posture the plan deliberately chose.
  - Confidence: MED — behaviorally safe but wasteful against a 50-points/day budget.
  - Blind spot: If null `sourceName` is common, this could routinely cut sets below 4.
- **Decision**: FIXED via Fix A — `hostnameOf()` helper in `RecipeCard.tsx`; credit falls back to the `sourceUrl` hostname (leading `www.` stripped) when `sourceName` is null.

### F2 — Repo lint gate is red at HEAD; the next push to `master` fails CI before deploy

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: .claude/hooks/post-edit.mjs (config gap in eslint.config.js)
- **Detail**: `npm run lint` fails with `Parsing error: .claude/hooks/post-edit.mjs was not found by the project service`. `.github/workflows/deploy.yml:23` runs `npm run lint` as a hard gate before `npm run build` and `wrangler deploy`, so production deploys are currently blocked. The file was introduced by `c52264a` (testing-harness), **not** by this slice — linting the slice's own files passes cleanly. It surfaces here because Phase 2–4's "Linting passes" criteria can no longer be re-verified repo-wide.
- **Fix**: Add `.claude/**` to the `ignores` list in `eslint.config.js` (the config currently has no `ignores` entry), or add the file to `tsconfig.json`'s `include`.
- **Decision**: FIXED — global `{ ignores: [".claude/**"] }` block added to `eslint.config.js`. `npm run lint` now exits 0 repo-wide.

### F3 — No catch-all on the proposals endpoint; an unexpected throw bypasses the envelope it defines

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/proposals.ts:56-82
- **Detail**: The handler body has no `try`/`catch`. Every *expected* failure is typed and mapped, but an unexpected throw escapes to Astro and produces an untyped 500 whose body is not `{ ok: false, reason }`. A concrete reachable path exists: `decodeEntities` (`src/lib/proposals.ts:58,61`) calls `String.fromCodePoint` on an unvalidated numeric entity, so a summary containing `&#x110000;` or `&#99999999;` throws `RangeError` synchronously inside `sanitizeSummary` → `toProposed` → `buildColdStartSet`. The client degrades tolerably (`ProposalList.tsx:45` catches the JSON parse failure and shows the network-error message), but this endpoint is explicitly the envelope convention later endpoints inherit (plan, Phase 3), so the gap propagates.
- **Fix**: Wrap the handler body in `try`/`catch` returning `json({ ok: false, reason: "internal_error" }, 500)`, and clamp the code point in `decodeEntities` (return the raw entity when it exceeds `0x10FFFF`). Add `internal_error` to `MESSAGE_BY_REASON` in `ProposalError.tsx`.
- **Decision**: FIXED — all three parts applied. `fromCodePoint()` guard added at `src/lib/proposals.ts:54`; out-of-range entities now stay literal instead of throwing (verified against a `&#x110000;` sample).

### F4 — Plan contradicts itself on the random-offset bound; the code follows the correct half

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/cold-start-proposals/plan.md:164 vs :197
- **Detail**: Phase 2 §2 specifies the offset is drawn from **0–20**, citing the 2026-07-20 measurement that `chinese`, `greek`, and `thai` return zero results at offset 50. Phase 2 §4 says "an independent random `offset` in **0–50**". The implementation uses `MAX_OFFSET = 20` (`src/lib/proposals.ts:28`) — the evidence-backed value — so the code is right and the plan text is stale. Left as-is, a future reader or `/10x-implement` run treats the plan as ground truth and could reintroduce the zero-result offset that burns quota points for nothing.
- **Fix**: Correct `plan.md:197` to say 0–20.
- **Decision**: FIXED — bullet corrected to 0–20 with an inline note that the earlier 0–50 draft was disproved by the 2026-07-20 measurement.

### F5 — `src/components/proposals/types.ts` hand-mirrors the endpoint's wire contract

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/proposals/types.ts:6-19
- **Detail**: An unplanned file (not named anywhere in the plan). Its content is benign and well-scoped, but `Proposal` is a byte-for-byte duplicate of the non-exported `ProposalPayload` in `src/pages/api/proposals.ts:18-27`, kept in sync only by the comment at `types.ts:1-5`. Adding a field to the payload leaves the client type silently stale with no type error. Structure creep rather than scope creep — worth recording, not reverting.
- **Fix**: Export `ProposalPayload` from the endpoint and have `types.ts` re-export it via `import type` (type-only imports are erased, so no server code reaches the client bundle).
- **Decision**: FIXED — `ProposalPayload` exported; `types.ts` now re-exports it as `Proposal` and builds `ProposalsResponse` from it. Erasure confirmed: `dist/client/_astro/*` contains no `api.spoonacular.com` or `SPOONACULAR_API_KEY` reference; only `dist/server/**` does.

### F6 — `on delete cascade` on `proposals.user_id` is an undocumented schema deviation

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: supabase/migrations/20260720181257_cold_start_proposals.sql:23
- **Detail**: The plan's Phase 1 contract specifies `user_id uuid not null references auth.users` with no delete behavior. The migration adds `on delete cascade`. The choice is sensible and conventional, but this is the repo's first migration, altering production tables is a human-only action, and the PRD's guardrail section is explicitly about rating-adjacent history surviving deletion events — so the semantics deserve to be recorded rather than inferred from the DDL.
- **Fix**: Add a one-line note to the plan's Migration Notes recording the cascade and why it was chosen.
- **Decision**: FIXED — addendum added to the plan's Migration Notes section. Schema unchanged (production DDL is a human-only boundary; the cascade is documented, not altered).

### F7 — The nutrition filter is a closed enumerated list; non-numeric health claims pass through

- **Severity**: 📝 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/proposals.ts:36-43
- **Detail**: `NUTRITION_FIGURE`, `NUTRITION_CLAIM`, and `PROVIDER_MENTION` are three fixed patterns enumerated from one day of live sampling (2026-07-20). They catch macro *figures* and two specific figure-free phrasings, but the PRD non-goal is broader — "no macro or nutritional data… the app makes no health claims". Spoonacular summary phrasings without a digit are not covered: e.g. "is high in protein", "a good option if you're following a gluten free diet", "super healthy". A leak here is a non-goal breach that no test will catch, and the plan already flags the sibling risk (silent drops) as lesson-worthy.
- **Fix**: Treat the pattern set as known-incomplete: add the diet/health-claim phrasings to `NUTRITION_CLAIM` (`\b(high|low|rich)\s+in\s+\w+`, `\bgluten[- ]free\b`, `\bdairy[- ]free\b`, `\b(super|very)?\s*healthy\b`, `\bdiet\b`) and record the closed-list fragility in `context/foundation/lessons.md`.
  - Strength: Cheap, additive, and the excerpt already degrades gracefully to `null` when the salvaged clause is too short.
  - Tradeoff: Each added pattern shortens more excerpts; over-cutting trades a licence risk for a blander card.
  - Confidence: LOW-MED — the phrasings above are plausible Spoonacular output but I did not call the live API to confirm them, and manual checks 2.3 and 4.7 passed against real payloads on 2026-07-21.
  - Blind spot: No sampled corpus of live summaries exists to measure the real leak rate either way.
- **Decision**: FIXED + ACCEPTED-AS-RULE: *Enumerated filters over third-party prose are known-incomplete, and their gaps are silent* — `NUTRITION_CLAIM` widened with `(high|low|rich) in X`, `(gluten|dairy|lactose)-free`, `healthy`, `diet`, `calorie`, `nutrition`, and the incompleteness stated at the definition. Lesson appended to `context/foundation/lessons.md`. Behavior checked against seven sample summaries: the figure-free health claim is now cut, and a clean summary with no nutrition language is left intact (no over-cutting).

### F8 — Provider `sourceUrl` is rendered into `href` with no protocol allowlist

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/proposals/RecipeCard.tsx:14,46
- **Detail**: `const link = proposal.sourceUrl ?? proposal.spoonacularSourceUrl` goes straight into `href={link}`. The value is third-party (publisher-supplied, relayed by Spoonacular) and is never checked for scheme, so a `javascript:` or `data:` value would reach the DOM. Exposure is genuinely low — the value comes from a curated provider, and React blocks/warns on `javascript:` hrefs — but this is the one place in the slice where untrusted remote data becomes an executable-capable attribute.
- **Fix**: Filter to `http:`/`https:` before rendering, e.g. accept the link only when `URL.canParse(link)` and the parsed protocol is `http:` or `https:`; otherwise render the credit without a link (which `RecipeCard` already handles).
- **Decision**: FIXED — `safeUrl()` in `RecipeCard.tsx` parses and protocol-checks both `sourceUrl` and `spoonacularSourceUrl`; anything else falls through to the no-link path. It also subsumes F1's `hostnameOf` helper, so the credit fallback reuses the same parsed URL.

### F9 — Named HTML entities beyond the five structural ones render literally in excerpts

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/proposals.ts:45-52 (pre-fix)
- **Detail**: Found during F7's verification run, not in the original sweep. The `ENTITIES` table held only `amp`, `lt`, `gt`, `quot`, `apos`, `nbsp`, and `decodeEntities` returns the raw match for anything else — so `Cr&egrave;me Br&ucirc;l&eacute;e` rendered on the card as the literal string `Cr&egrave;me Br&ucirc;l&eacute;e`. The plan's Phase 2 §3 contract says the sanitizer "decodes common HTML entities"; in a recipe corpus, accented Latin-1 and typographic entities are the common ones. Numeric forms (`&#233;`, `&#xE9;`) were already handled.
- **Fix**: Extend `ENTITIES` with typographic punctuation (`hellip`, `mdash`, `ndash`, curly quotes, `deg`, vulgar fractions) and the Latin-1 accented set.
- **Confidence**: MED on the defect (reproduced directly), LOW on incidence — the sample was synthetic; I did not call the live API to confirm Spoonacular emits named rather than numeric entities.
- **Decision**: FIXED — table extended to 40 entries; `Cr&egrave;me` now decodes to `Crème`.
