# Extract the compliance barrier from the slot engine (C4) — Implementation Plan

## Overview

`src/lib/proposals.ts` is a 480-line file holding two disjoint concerns: a ~175-line **content-policy barrier** (`:67-241`) that sanitizes the provider's HTML `summary` into a compliant plain-text excerpt, and the **FR-008 slot engine** (`:243-480`) that assembles proposal sets. They are joined by exactly one seam — `excerpt: sanitizeSummary(recipe.summary)` inside `toProposed` (`:258`).

This plan separates them into their own modules and then gives the barrier the test coverage it has never had. It is the #1-ranked refactor opportunity from `context/changes/refactor-opportunities/research.md` §5: highest debt cost relative to change cost in the repo.

## Current State Analysis

**The barrier is the only mechanism defending two hard product constraints:**

- PRD Non-Goals, "no macro or nutritional data" — Spoonacular `summary` routinely embeds calorie and macro figures inline. `NUTRITION_FIGURE` (`:73`) and `NUTRITION_CLAIM` (`:81-82`) cut the excerpt before them.
- PRD NFR, "strips markup and never injects third-party anchors" — tag stripping (`:216`) plus `PROVIDER_MENTION` (`:85`) cutting the provider's own backlink wording, which survives tag removal as anchor text.

**It has zero test coverage.** Verified mechanically: `grep -rn "sanitizeSummary" src` returns exactly 2 hits — the declaration (`:211`) and the single call (`:258`). `src/lib/__tests__/proposals.test.ts` references neither `sanitizeSummary` nor `excerpt`. This matches research T12 and D-1.

**The collocation is the direct cause of that zero.** Testing sanitization today means routing input through the slot engine's fixtures — provider-result stubs, cuisine pinning, set assembly — rather than calling a function with a string and asserting a string. The research names this as the causal link, not a coincidence.

**Nothing outside the block references its symbols.** `grep` across `src/` for every constant and helper in `:67-241` (`MAX_EXCERPT`, `MIN_EXCERPT`, `NUTRITION_FIGURE`, `NUTRITION_CLAIM`, `PROVIDER_MENTION`, `ENTITIES`, `DANGLING`, `fromCodePoint`, `decodeEntities`, `firstStopIndex`, `toSentenceBoundary`, `ellipsize`, `trimDangling`, `truncate`) returns zero hits outside `src/lib/proposals.ts`.

**The block boundaries are clean.** Lines `:67-241` are contiguous and self-contained: `DANGLING` (`:183-184`) sits inside the block despite appearing after several helpers, and the engine's own constants (`PER_CALL:58`, `SET_SIZE:59`, `MAX_OFFSET:65`) all sit *above* line 67 and stay put.

**The safety net is the compiler, not CI.** `.github/workflows/ci.yml` runs `npm ci` → `astro sync` → `lint` → `build`. Neither Vitest nor Playwright appears in any workflow; the full suite runs only via `.husky/pre-push`. Regex and string behavior is invisible to the type checker — which is precisely why Phase 2 exists.

## Desired End State

`src/lib/sanitize-summary.ts` exists as a single-responsibility module exporting exactly one symbol, `sanitizeSummary`. `src/lib/proposals.ts` is ~175 lines shorter and contains only the FR-008 slot engine, importing the barrier at its one seam. `src/lib/__tests__/sanitize-summary.test.ts` pins the compliance guarantees as plain input/output assertions.

Verify by: `npm run build` passes (the seam typechecks), `npm test` passes with the new file green and `proposals.test.ts` unchanged and still green, and `grep -rn "NUTRITION_\|ENTITIES\|sanitizeSummary" src/lib/proposals.ts` returns only the import line and the call site.

### Key Discoveries:

- Single seam: `src/lib/proposals.ts:258` — the only call site in the repo.
- Zero test-file impact: `src/lib/__tests__/proposals.test.ts` never imports the symbol (research T12).
- Zero external consumers of any block-private symbol (verified by grep across `src/`).
- Block `:67-241` is contiguous; engine constants live at `:58,59,65`, above the cut.
- `vitest.config.ts` glob is `src/**/__tests__/**/*.test.ts`, `environment: "node"`, `@/` alias wired manually — a new `.test.ts` under `src/lib/__tests__/` is picked up with no config change.
- `context/foundation/lessons.md` records the filter set as **known-incomplete by design** — tests must not assert the pattern list is closed.

## What We're NOT Doing

- **Not touching C1 (envelope typing) or C3 (orchestration node).** Scope is C4 only.
- **Not widening `NUTRITION_CLAIM` or `ENTITIES`.** Re-widening needs fresh provider payload samples, which spends quota and would make this plan depend on an external call. Deferred; the tests written here are the safety net that makes a later widening cheap.
- **Not changing any behavior.** Phase 1 is a verbatim move. If a test in Phase 2 reveals a defect, it is not fixed here — but it is not merely noted either. Per `lessons.md` ("Never close a compliance slice guarded only by a test"), a deferred compliance follow-on must be a *named* work item, so each revealed defect gets a `/10x-new` change folder (or, if it is a new class of gap rather than an instance, a `lessons.md` entry) before this change can close. See Phase 2 step 2.7.
- **Not exporting the helpers.** Only `sanitizeSummary` becomes public; the seam stays one function wide.
- **Not adding a `coverage` block to `vitest.config.ts`**, not adding jsdom/RTL, not touching CI workflows.
- **Not renaming the module to something policy-flavored** (`content-policy.ts`) — the research's proposed path is kept for discoverability.

## Implementation Approach

Two phases, strictly ordered. Phase 1 is a pure structural move with no behavior delta, so it is verifiable by the compiler plus the unchanged existing suite. Phase 2 then writes the tests that the new module shape makes possible — input string in, excerpt out, no engine fixtures.

The order matters and is not interchangeable: writing the tests first would mean writing them against the engine's fixture surface, which is the exact friction that produced the current zero coverage.

## Critical Implementation Details

**Ordering within the move.** The block is contiguous but its symbols have internal dependencies (`sanitizeSummary` → `firstStopIndex` → the three regexes; `truncate` → `ellipsize`). Move `:67-241` as one contiguous slice preserving intra-block order rather than reassembling it — that keeps the diff reviewable as a move and avoids introducing a use-before-define hazard among the `const` regexes, which are not hoisted.

**Comment ownership.** The block's comments carry the *reasons* the barrier exists (PRD non-goal citations at `:71-72`, the known-incomplete warning at `:77-80` pointing to `lessons.md`, the RangeError rationale at `:136-137`, the decimal-point misread rationale at `:162-163`). They move with the code verbatim — they are the only record of why these patterns are shaped as they are.

---

## Phase 1: Verbatim extraction

### Overview

Move the content-policy block into its own module and import it back at the single seam. No behavior change, no test change.

### Changes Required:

#### 1. New content-policy module

**File**: `src/lib/sanitize-summary.ts`

**Intent**: Hold the provider-summary sanitization barrier as a standalone concern, so changes to content policy and changes to slot rules stop passing through the same file. Receives lines `:67-241` of `src/lib/proposals.ts` verbatim, comments included.

**Contract**: Exports exactly one symbol — `export function sanitizeSummary(summary: string | null): string | null`, signature unchanged from `src/lib/proposals.ts:211`. Everything else in the moved block (`MAX_EXCERPT`, `MIN_EXCERPT`, `NUTRITION_FIGURE`, `NUTRITION_CLAIM`, `PROVIDER_MENTION`, `ENTITIES`, `DANGLING`, and the seven helpers `fromCodePoint`, `decodeEntities`, `firstStopIndex`, `toSentenceBoundary`, `ellipsize`, `trimDangling`, `truncate`) stays module-private. The module has no imports — the block depends on nothing outside itself. Add a file-header comment naming what the module defends (PRD Non-Goals "no macro or nutritional data", the markup-stripping NFR) and pointing at `context/foundation/lessons.md` for the known-incomplete rule.

#### 2. Slot engine loses the barrier

**File**: `src/lib/proposals.ts`

**Intent**: Delete the moved block and import the barrier back, leaving the file as the FR-008 slot engine alone. The call inside `toProposed` is unchanged.

**Contract**: Remove lines `:67-241`. Add `import { sanitizeSummary } from "@/lib/sanitize-summary";` alongside the existing imports at the top (`@/` alias per repo convention, not a relative path). `toProposed`'s body is untouched — `excerpt: sanitizeSummary(recipe.summary)` still resolves, now through the import. `PER_CALL`, `SET_SIZE`, and `MAX_OFFSET` stay; they sit above the cut and belong to the engine.

#### 3. Lessons register follows the code

**File**: `context/foundation/lessons.md`

**Intent**: Keep the known-incomplete rule pointing at the code it governs. The new module's header cites `lessons.md`; without this the link is one-way into a file that no longer holds the patterns — and this lesson is re-read at start by `/10x-plan`, `/10x-plan-review`, and `/10x-implement`.

**Contract**: In the "Enumerated filters over third-party prose..." entry only, repoint **Context** from `src/lib/proposals.ts:34-43` to `src/lib/sanitize-summary.ts` (dropping the line range, which is already stale — the regexes sit at `:71-85` today) and **Applies to** from `sanitizeSummary` in `src/lib/proposals.ts` to `src/lib/sanitize-summary.ts`. The rule text and every other entry are untouched; the register stays append-only in substance.

### Success Criteria:

#### Automated Verification:

- Astro types are current: `npm run astro sync`
- Linting passes: `npm run lint`
- Production build passes — the seam typechecks: `npm run build`
- Full suite passes with no test file modified: `npm test`
- `src/lib/proposals.ts` retains no policy symbol except the import and the call: `grep -n "NUTRITION_\|ENTITIES\|MAX_EXCERPT\|sanitizeSummary" src/lib/proposals.ts` returns only the import line and `toProposed`'s call
- **The move is byte-identical** — no test exercises `sanitizeSummary`, so neither the compiler nor `npm test` can see a mangled regex; this is Phase 1's only real evidence. From the new module, extract the moved slice (everything below the file header, with `export ` stripped from the `sanitizeSummary` declaration) and diff it against the original:
  `diff <(git show HEAD:src/lib/proposals.ts | sed -n '67,241p') <(sed -n '<first-moved-line>,$p' src/lib/sanitize-summary.ts | sed 's/^export function sanitizeSummary/function sanitizeSummary/')`
  must print nothing. Any output is a mangled move, not a stylistic delta.

#### Manual Verification:

- The diff on `src/lib/sanitize-summary.ts` reads as a move: every comment from the original block is present, and the intra-block order of declarations is preserved
- No symbol other than `sanitizeSummary` carries `export` in the new module
- `git diff --stat` shows exactly two source files changed and zero test files (plus the `context/foundation/lessons.md` pointer edit)
- `lessons.md`'s known-incomplete entry names `src/lib/sanitize-summary.ts` in both Context and Applies-to, and its rule text is unchanged

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2. Phase 1 must be a clean, behavior-neutral commit on its own — that is what makes Phase 2's findings attributable.

---

## Phase 2: Cover the barrier

### Overview

Write the tests the extraction makes possible. Every assertion is a plain string in, string-or-null out — no provider stubs, no slot-engine fixtures.

### Changes Required:

#### 1. Test file for the extracted module

**File**: `src/lib/__tests__/sanitize-summary.test.ts`

**Intent**: Pin the compliance guarantees and the text-shaping behavior of `sanitizeSummary`, so a future widening of the pattern set (or an accidental regression in it) is caught locally rather than shipping a macro figure onto a card.

**Contract**: A Vitest suite importing only `sanitizeSummary` from `@/lib/sanitize-summary`. Picked up automatically by the existing `src/**/__tests__/**/*.test.ts` glob; no config change. Assertions grouped by concern:

- **Compliance — macro figures** (PRD Non-Goals): a summary containing a calorie count, a `Ng of protein` figure, and a `grams of` phrase is cut before the figure in each case. Assert the figure's digits do not appear in the output, not that the output equals a fixed string.
- **Compliance — nutrition claims**: every alternation branch of `NUTRITION_CLAIM` gets at least one pinning case — `covers N%`, `N% of your daily`, `high in <nutrient>` (and a `low in` / `rich in` variant), `gluten free` (plus a `dairy-free` hyphen form), `Watching your figure?`, and the bare-word tail `super healthy` / `diet` / `calorie` / `nutrition`. That last group is the widening `lessons.md` records as added *after* the original set missed "super healthy" and "gluten free diet"; it is the branch most likely to be dropped by a future re-widening, so it must not be the one left unpinned. Assert the claim text is absent from the output.
- **Compliance — provider backlink**: `spoonacular` in prose (i.e. surviving anchor text after tag stripping) terminates the excerpt; the word never appears in output.
- **Markup**: HTML tags are stripped; stray `<` / `>` do not survive; whitespace collapses to single spaces.
- **Entity decoding**: a named entity (`&egrave;`), a decimal numeric entity (`&#233;`), and a hex numeric entity (`&#xE9;`) all decode; an unknown named entity and an out-of-range numeric entity (past `0x10FFFF`) are left literal rather than throwing — this is the `fromCodePoint` RangeError guard, and a throw here would 500 a whole set.
- **Sentence boundary**: when a complete sentence precedes the stop point, the excerpt ends at that sentence's terminator. A decimal like `$4.62 per serving` is **not** treated as a sentence end (the documented misread that would truncate to `For $4.`).
- **Dangling-clause salvage**: with no sentence boundary before the stop, a clause long enough is trimmed of trailing connectives and ellipsized; a salvaged clause shorter than the minimum yields `null` rather than a stub.
- **Length**: input longer than the max is truncated at a word boundary and ellipsized.
- **Null/empty**: `null` input returns `null`; a summary that is only markup or only whitespace returns `null`.

**Discipline — do not mirror the implementation.** Assert on *observable outcomes* (the forbidden substring is absent, the output is at most the cap, the result is `null`) rather than importing or restating `MAX_EXCERPT`, `MIN_EXCERPT`, or the regex sources. The repo's mirror-test convention is stated in `src/lib/proposals.ts:47-49`. Concretely: assert `result.length <= 161` (cap plus the ellipsis) with the number written literally, not `MAX_EXCERPT`.

**Discipline — do not assert the filter set is closed.** `lessons.md` records this enumeration as permanently incomplete and expected to widen. Tests assert that *listed* phrasings are caught; none may assert that an unlisted phrasing passes through, since that would lock the set shut and turn a correct widening into a red test.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Build still passes: `npm run build`
- Full suite passes, new file included: `npm test`
- The new file is discovered by the existing glob with no config edit: `npx vitest run src/lib/__tests__/sanitize-summary.test.ts`

#### Manual Verification:

- No assertion imports or restates a module-private constant or regex from `sanitize-summary.ts`
- No test asserts that an *unlisted* nutrition phrasing survives sanitization
- Any behavior the tests reveal as wrong becomes a **named follow-up**, not a note: open a `/10x-new` change folder for each instance (or append a `lessons.md` rule if it is a new class of gap), and link it from `change.md` Notes. `lessons.md` forbids parking a compliance follow-on as a scope-exclusion line; this change may not be marked done while a revealed defect has no linked follow-up. Nothing is fixed inside this plan
- Spot-check one real Spoonacular `summary` string (from an existing fixture in `src/lib/__tests__/proposals.test.ts` or `spoonacular.test.ts`) through the function and confirm the excerpt is card-appropriate

**Implementation Note**: This phase closes the change. Pause for manual confirmation before marking it done.

---

## Testing Strategy

### Unit Tests:

- `sanitizeSummary` compliance guarantees: macro figures, nutrition claims, provider backlink wording
- Entity decoding including the out-of-range numeric guard (a throw here escalates one malformed summary into a 500 for a whole set)
- Text shaping: sentence-boundary detection with the decimal-point exception, dangling-clause salvage vs `null`, length truncation
- Null and empty-after-stripping inputs

### Integration Tests:

None added. The seam is a single function call already exercised end-to-end by the existing `src/lib/__tests__/proposals.test.ts` and `src/pages/api/__tests__/proposals.test.ts`, which must stay green and unmodified through Phase 1 — that is the integration check.

### Manual Testing Steps:

1. Run `npm run dev`, sign in, request a proposal set, and confirm card excerpts render as plain text with no visible markup, no `&egrave;`-style literals, and no calorie or macro figures.
2. Confirm no excerpt reads as a truncation stub (e.g. `For $4.` or `...serves 4 and has…`).
3. Confirm no excerpt mentions "spoonacular".

## Performance Considerations

None. The move is compile-time only; the same functions run on the same inputs. Module count grows by one, which is irrelevant on the Cloudflare Workers bundle at this size.

## Migration Notes

Not applicable — no schema, no data, no wire contract touched. `ProposedRecipe.excerpt` and every API response shape are unchanged. Rollback is `git revert` of either phase independently.

## References

- Research: `context/changes/refactor-opportunities/research.md` §2 (C4 evidence), §4.1 (migration feasibility), §5 #1 (ranking rationale), §5a T10–T12 (ast-grep verification)
- Upstream evidence: `context/changes/proposals-dataflow/research.md` D-1
- Known-incomplete rule: `context/foundation/lessons.md`
- Source of the seam: `src/lib/proposals.ts:258`
- Mirror-test convention: `src/lib/proposals.ts:47-49`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Verbatim extraction

#### Automated

- [ ] 1.1 Astro types are current: `npm run astro sync`
- [ ] 1.2 Linting passes: `npm run lint`
- [ ] 1.3 Production build passes — the seam typechecks: `npm run build`
- [ ] 1.4 Full suite passes with no test file modified: `npm test`
- [ ] 1.5 `src/lib/proposals.ts` retains no policy symbol except the import and the call
- [ ] 1.6 The move is byte-identical: `diff` of the moved slice against `git show HEAD:src/lib/proposals.ts | sed -n '67,241p'` prints nothing

#### Manual

- [ ] 1.7 The diff on `src/lib/sanitize-summary.ts` reads as a move: comments present, declaration order preserved
- [ ] 1.8 No symbol other than `sanitizeSummary` carries `export` in the new module
- [ ] 1.9 `git diff --stat` shows exactly two source files changed and zero test files (plus the `lessons.md` pointer edit)
- [ ] 1.10 `lessons.md`'s known-incomplete entry names `src/lib/sanitize-summary.ts` in Context and Applies-to, rule text unchanged

### Phase 2: Cover the barrier

#### Automated

- [ ] 2.1 Linting passes: `npm run lint`
- [ ] 2.2 Build still passes: `npm run build`
- [ ] 2.3 Full suite passes, new file included: `npm test`
- [ ] 2.4 New file discovered by the existing glob with no config edit

#### Manual

- [ ] 2.5 No assertion imports or restates a module-private constant or regex
- [ ] 2.6 No test asserts that an unlisted nutrition phrasing survives sanitization
- [ ] 2.7 Every revealed defect has a named follow-up (`/10x-new` change folder, or a `lessons.md` rule for a new class of gap) linked from `change.md` Notes — not fixed here, and not left as a bare note
- [ ] 2.8 Spot-check one real Spoonacular `summary` fixture through the function
