<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Storage-Field Discipline (#4) + Request-Side Cuisine Diversity (#5)

- **Plan**: `context/changes/testing-storage-diversity-units/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-09
- **Verdict**: REVISE
- **Findings**: 1 critical, 5 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL |
| Lean Execution | WARNING |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

`8/8 paths ✓, 14/14 symbols & line refs ✓, brief↔plan ✓, Progress↔Phase contract ✓, contract-surfaces grep 0 hits`

Every `file:line` the plan cites was checked and matches exactly: `src/pages/api/proposals.ts:185-188` (recipes upsert, explicit 3-key selection), `:195-202` (proposals insert), `:199` (`requested_cuisine`), `:147,162-166` (`persist()` receives the wide `ProposedRecipe[]`); `src/lib/proposals.ts:5` (`CUISINES`), `:243-248` (`pickCuisinePair`), `:254-260` (`toProposed`), `:302-338` (`buildColdStartSet`, `:335` the ≥2 computation, `:337` the return), `:346` (`fromById` → `null`); `src/lib/spoonacular.ts:6-14, 54-72` (`RecipeCandidate` / `toCandidate` — all seven keys are always present in the returned literal, so `Object.keys(...).sort()` is deterministic). Test-side: `src/lib/__tests__/proposals.test.ts:13` imports `CUISINES`, used only at `:87` and `:205` (removal is correct and lint-forced); `EXPECTED_CALLS`/`ITERATIONS` exist at module scope; the `mockClear()`-not-`mockReset()` counter idiom at `:60-66` is as described; `src/pages/api/__tests__/proposals.test.ts:280-291` does indeed never read `upsert.mock.calls[0][0]`. Suite verified live: **6 files, 66 tests, green, 1.89 s**. `npm test` = `vitest run`; `npm run lint` = `eslint .`. The Progress block matches the predecessor slice's parser format exactly (`### Phase N: <name>` / `#### Automated` / `#### Manual`), and every Success Criteria bullet has a numbered Progress counterpart (1.1–1.11, 2.1–2.11, 3.1–3.5).

`docs/reference/contract-surfaces.md` exists; a `grep -F` of its five H2 headings against the plan returned no hits, so no surface is renamed or reshaped. Substantively the plan's oracles agree with that file's "Storable indefinitely" table and its `RecipeCandidate` listing — no contract break.

## Findings

### F1 — The by-id NULL provenance test proves nothing about `fromById`

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 1 → Changes Required #4 ("`requested_cuisine` provenance — the 'must challenge' test"); Desired End State item 3
- **Detail**: The plan calls the NULL on by-id rows "the test's sharpest evidence" and "the sharpest single test in the slice" — *"a provider-derived column would have been populated there."* But the test lives at the **endpoint** layer, where `@/lib/proposals` is module-mocked (`src/pages/api/__tests__/proposals.test.ts:16-19`) and the fixture itself supplies `requestedCuisine: null` for slots 1/2. The endpoint only copies `p.requestedCuisine` (`src/pages/api/proposals.ts:199`). So the assertion proves the endpoint does not *invent* a cuisine — it cannot observe the claim it is billed as proving, which is that `fromById` passes `null` (`src/lib/proposals.ts:346`) even though the by-id response carries `cuisines[]`.

  Concretely: mutate `fromById` to `toProposed(result.recipes, (result.recipes[0] as { cuisines?: string[] }).cuisines?.[0] ?? null)`. The endpoint test stays green (its fixture hard-codes `null`). The only existing engine assertion, `expect(slot1.requestedCuisine).toBeNull()` at `src/lib/__tests__/proposals.test.ts:252`, also stays green — because `candidate()` (`:32-43`) is a *clean* fixture with no `cuisines` field, which is precisely the "a clean fixture cannot fail" trap the plan itself names in §Key Discoveries. Nothing in Phases 1 or 2 closes this: Phase 2's `dirtyCandidate()` is used only for the two `searchRecipes` pools, never for the `getRecipeById` path. Desired End State item 3 ("sources `requested_cuisine` from anything other than the pinned request param") is therefore backed on the search branch and unbacked on the by-id branch — the branch the plan singles out as its strongest evidence.
- **Fix A ⭐ Recommended**: Add an engine-layer assertion in `src/lib/__tests__/proposals.test.ts` that drives `byId.mockImplementation` with a **dirty** by-id candidate carrying `cuisines: ["thai"]`, and asserts the slot-1/2 proposals have `requestedCuisine === null`. Add the matching mutation check to Phase 2's Manual Verification: *"source `fromById`'s cuisine from `result.recipes[0].cuisines?.[0]` at `src/lib/proposals.ts:346` → the by-id-NULL test goes red; restore."* Keep the endpoint assertion but re-describe it in the plan as "the endpoint does not invent a cuisine," not as the provenance proof.
  - Strength: Puts the assertion at the only layer that can see `fromById`, in a file the slice already edits, reusing `mockSteadyProviders()` (`:169-179`) — the dirty-candidate factory Phase 2 change #3 already introduces is the same helper. Costs one `it` block.
  - Tradeoff: Adds a Phase 2 item to what the plan frames as a Phase 1 (risk #4) concern, so the phase boundary blurs slightly; Phase 1's mutation-check pause no longer covers the whole of end-state item 3.
  - Confidence: HIGH — verified by reading both call sites; the endpoint test's `vi.mock("@/lib/proposals", …)` factory makes the engine unobservable from that layer, and `candidate()` carries no `cuisines` key.
  - Blind spot: Whether `dirtyCandidate()` returning a wider-than-`RecipeCandidate` variable survives `byId.mockImplementation((id) => Promise.resolve(okById(id)))`'s inferred return type without a cast has not been compiled.
- **Fix B**: Drop the "sharpest evidence" framing entirely — restate Phase 1 change #4 as an endpoint-carriage assertion, and record the `fromById` provenance gap under §What We're NOT Doing with a pointer to rollout Phase 2 or 3.
  - Strength: Zero new test code; keeps Phase 1 strictly at the DB boundary and the phases cleanly separated.
  - Tradeoff: Leaves `change.md`'s mandated "must challenge" — *"requested cuisine is a provider recipe field"* — only half-refuted by an automated gate, which is the specific thing this slice exists to deliver.
  - Confidence: MEDIUM — honest, but it converts a covered risk into a documented one.
  - Blind spot: Rollout Phase 2/3's risk lists (`test-plan.md:85-86`) do not currently name #4, so the deferral would land nowhere — see F4.
- **Decision**: FIXED via Fix A — added Phase 2 change #6 (`fromById` records NULL against a dirty by-id candidate, engine layer, reusing `mockSteadyProviders()` and change #3's `dirtyCandidate()`), added the matching `:346` mutation check to Phase 2 Manual Verification (2.12), and re-described Phase 1 change #4 + the §Key Discoveries NULL bullet as endpoint-carriage ("does not invent a cuisine") rather than the provenance proof. Phase 2 Overview now names the deliberate risk-per-phase exception.

### F2 — Nothing asserts `degraded` against a contradictory `cuisines[]`, and the test has no mutation check

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 2 → Changes Required #3 ("Diversity survives a contradictory response `cuisines[]`"); Desired End State item 6; Phase 2 → Manual Verification
- **Detail**: Desired End State item 6 is *"computes `degraded` from the response body instead of the request side."* Change #3 is the only step that feeds a contradictory `cuisines[]`, and its contract asserts (a) no delivered proposal carries the sentinel and (b) the delivered `requestedCuisine` set equals the cuisines read back from `search.mock.calls`. **Neither touches `degraded`.**

  The mutation `const cuisinesCovered = new Set(proposals.map((p) => p.cuisines?.[0] ?? p.requestedCuisine)).size` at `src/lib/proposals.ts:335` survives: against change #1's clean `candidate()` fixture the `??` falls through to `requestedCuisine` → 2 → `degraded: false` → green; against change #3's dirty fixture every recipe reports the sentinel → 1 → `degraded: true`, but change #3 never reads `degraded`. Note that `toProposed` is `{ ...recipe, … }` (`:255-259`), so an extra `cuisines` key on a `dirtyCandidate` genuinely reaches `ProposedRecipe` at runtime — the mutation is reachable, not hypothetical.

  Compounding this: Phase 2's Manual Verification lists four mutation checks, and **none of them covers change #3** (they cover changes #1, #2, #4, and #5). The plan's own standard is *"A storage test that cannot be made to fail is worse than no test."* Change #3 is the direct refutation of `change.md`'s "must challenge" for #5 and is the one Phase 2 test shipping without proof it can redden.
- **Fix ⭐**: Extend change #3's contract with `expect(result.degraded).toBe(false)` — the contradictory fixture pins two cuisines and delivers both, so `degraded` must stay false even though the response body reports a single cuisine. Add the mutation check to Phase 2 Manual Verification: *"change `:335` to `new Set(proposals.map((p) => (p as { cuisines?: string[] }).cuisines?.[0] ?? p.requestedCuisine)).size` → the contradictory-`cuisines[]` test goes red; restore."* Add a `2.12` line to the Progress block.
  - Strength: One assertion plus one mutation line closes end-state item 6 and gives the slice's sharpest #5 test the same redden-proof every other test in the plan carries.
  - Tradeoff: None material — same fixture, same `describe`, no new mock wiring.
  - Confidence: HIGH — the `??` fall-through mutation was traced against both fixtures and `toProposed`'s spread.
  - Blind spot: Whether the plan wants Phase 2's Progress renumbered (2.12) or the new bullet folded into 2.4.
- **Decision**: FIXED via the single Fix — Phase 2 change #3's contract gained clause (c) `degraded === false` with the `??` fall-through reasoning; the `:335` mutation check was added to Phase 2 Manual Verification. Resolving the blind spot: the assertion is folded into criterion 2.4's wording and the mutation check got its own Progress line (2.11), since F1 forced a full Phase 2 renumber anyway.

### F3 — Marking rollout Phase 1 `complete` claims a CI gate that does not exist

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 → Changes Required #3 ("Rollout status + gate note"); §What We're NOT Doing ("CI gate wiring")
- **Detail**: `context/foundation/test-plan.md:128` reads: `| unit | local + CI | required after §3 Phase 1 | …`. Flipping §3 Phase 1's Status to `complete` therefore flips that gate from `planned` to **required** — §5's own definition: *"'Required after §3 Phase `<N>`' means the gate is enforced once that rollout phase lands."* But `.github/workflows/ci.yml` runs `npm ci`, `npx astro sync`, `npm run lint`, `npm run build` — **there is no `npm test` step**, and the plan explicitly excludes CI wiring ("rollout Phase 4, per the CLAUDE.md lesson boundary"). The result is a test plan asserting an enforced gate that no pipeline runs: a regression that reddens locally still merges. Phase 3's Manual Verification asks the reader to confirm *"§3 Phase 1 `complete` is honest"* — this is the specific way it would not be.
- **Fix A ⭐ Recommended**: In Phase 3 change #3, also amend §5's unit-gate row to separate satisfaction from enforcement — e.g. Required? → `runnable locally now; enforced in CI after §3 Phase 4`, and add a clause to the Catches cell noting the suite covers quota/call-count, storage-field, and diversity. §3 Phase 4's row already owns *"enforce the test gates in CI"*, so this only makes the existing sequencing explicit.
  - Strength: Keeps the declared scope boundary intact (no `ci.yml` edit), and makes Phase 1 `complete` an honest claim about coverage rather than a false claim about enforcement. One-cell doc edit in a file Phase 3 already rewrites.
  - Tradeoff: The regression gate remains unenforced on PRs until rollout Phase 4 lands — the risk this slice exists to close stays open in CI.
  - Confidence: HIGH — `ci.yml` was read; there is no test step, and `npm test` is a defined script (`vitest run`).
  - Blind spot: Whether `/10x-implement`'s status-vocabulary parser or the orchestrator reads §5's Required? cell as a fixed literal; the §3 Status column is the documented parser literal, §5 is prose, but this was not confirmed.
- **Fix B**: Add a `- run: npm test` step to `.github/workflows/ci.yml` in Phase 3 so the `complete` status is true as written.
  - Strength: The gate becomes real the moment Phase 1 closes; no wording gymnastics; ~2 lines and no secrets needed (the suite is fully stubbed and spends zero quota).
  - Tradeoff: Directly contradicts the plan's §What We're NOT Doing and the CLAUDE.md lesson boundary that reserves gate wiring for rollout Phase 4 — a declared scope decision being overturned inside a review, and it makes this a non-test-only slice.
  - Confidence: MEDIUM — technically trivial and safe (suite is 1.89 s, no env vars), but it is a scope decision the plan already made deliberately.
  - Blind spot: Whether rollout Phase 4's plan expects to own the full gate-wiring commit and would now find it half-done.
- **Decision**: FIXED via Fix A — Phase 3 change #3's contract now requires §5's unit-gate Required? cell to read `runnable locally now; enforced in CI after §3 Phase 4`, with the reasoning (no `npm test` step in `ci.yml`) stated inline. No `ci.yml` edit, so §What We're NOT Doing stays intact. Phase 3 Manual Verification item 3.4 now checks the Required? cell too.

### F4 — The A3 migration-schema deferral has no owning phase

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: A3; §What We're NOT Doing; Phase 3 → Changes Required #3 (final sentence)
- **Detail**: A3 defers the migration column-set assertion to *"rollout Phase 3's integration tier against a local Supabase."* Risk #4's Response Guidance (`test-plan.md:71`) asks for *"the persist/upsert path **and the exact column set the migration writes**"* — so the deferral is a real half of the risk. But `test-plan.md:86` gives rollout Phase 3 `Risks covered = #2, #3, #7`; **#4 is not in that cell**, and Phase 3's goal line says nothing about storage-field discipline. Phase 3 change #3 of this plan proposes recording the deferral *"under §7 (or as a §3 sequencing note)"* — §7 is titled **"What We Deliberately Don't Test"** and is described as *"Exclusions … Future contributors should respect these unless the underlying assumption changes."* Filing a temporary deferral there converts it into a permanent exclusion, which is the opposite of the intent; and "a §3 sequencing note" is unspecified. The net effect: Phase 1 closes as `complete` for #4 while the residual half is logged in a place that either mis-labels it or is undefined.
- **Fix A ⭐ Recommended**: In Phase 3 change #3, amend `test-plan.md:86` so the Phase 3 row reads `Risks covered = #2, #3, #7, #4 (schema-column half)` and extend its Goal cell with "…and confirm the `recipes` column set against a live schema". Drop the "(or as a §7 entry)" alternative from the contract — §7 is for permanent exclusions only.
  - Strength: Gives the deferral a named owner in the same table the orchestrator reads, so it resurfaces when Phase 3 opens rather than being re-discovered as an oversight. It also makes Phase 3's Manual Verification item 3.5 ("the A3 deferral is visible in the test plan") checkable against a specific cell.
  - Tradeoff: Widens rollout Phase 3's declared scope, which was sized around ratings persistence/isolation; a future reader may read #4 as re-opened rather than partially carried.
  - Confidence: HIGH — both `test-plan.md` cells were read; #4 appears only in the Phase 1 row.
  - Blind spot: Whether the roadmap sequencing for Phase 3 (gated on S-03/S-05, both now shipped) has capacity assumptions this would disturb.
- **Decision**: FIXED via Fix A — Phase 3 change #3 now requires `test-plan.md:86`'s Risks covered cell to read `#2, #3, #7, #4 (schema-column half)` with the Goal cell extended to name the live-schema column check; the "(or as a §7 entry)" alternative was dropped with an explicit note that §7 is for permanent exclusions. Progress 3.5 now cites that specific cell.
- **Fix B**: Keep the deferral in this change folder only, and change Phase 3's Manual Verification item 3.5 to drop the "visible in the test plan" requirement.
  - Strength: No edit to a shared foundation doc; the reasoning stays where the decision was made.
  - Tradeoff: Contradicts the plan's own stated aim — *"recorded so it is not re-discovered as new"* — and change folders get archived, so the note effectively disappears.
  - Confidence: MEDIUM — internally consistent but abandons the goal A3 was written to serve.
  - Blind spot: Whether `/10x-archive` preserves change-folder notes in a way future planning reads.

### F5 — The `VERIFIED_CUISINES` oracle's cited source does not support its stated risk-#5 payload

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: §Oracle constants table (row 5); §Key Discoveries ("The `CUISINES` mirror test has a risk-#5 payload"); A5; Phase 2 → Changes Required #4
- **Detail**: The plan justifies taking the out-of-scope `CUISINES` drive-by (A5) on the grounds that the six are *"the six cuisines the F-01 spike measured as returning full results, so an unverified cuisine (which may return 200-with-zero-results and collapse diversity — precisely risk #5's failure mode) cannot ship silently."* Both halves are off:

  1. **Source.** `context/archive/2026-07-16-spoonacular-retrieval-spike/findings.md` mentions the six only once, at `:56`, as an *"incidental positive signal"* inside the deferred locale question — at `number=10` with no offset, and explicitly hedged: *"corpus depth was never the binding constraint **at this sample size**."* The authoritative six-value list and its caveat live in `context/archive/2026-07-20-cold-start-proposals/plan.md:162-164`, a different change measured four days later.
  2. **Payload.** That same measurement records: *"at offset 50, `chinese`, `greek`, and `thai` return zero results."* Half the "verified" six are demonstrably thin. Membership in `VERIFIED_CUISINES` therefore does **not** protect against the 200-with-zero-results collapse — `MAX_OFFSET = 20` does, and that bound is already pinned by `OFFSET_MAX` at `src/lib/__tests__/proposals.test.ts:85-86`.

  The allow-list is still worth adding — it genuinely guards wholesale pool replacement, which the imported-constant version cannot. But since the plan's whole oracle discipline rests on a reader being able to follow the cited source to the value, shipping an in-file comment that cites a document not containing the claim undermines the practice this slice is establishing, and the wrong causal story will propagate into the test-plan cookbook via Phase 3.
- **Fix**: Change the §Oracle constants source cell and the in-file comment to cite `context/archive/2026-07-20-cold-start-proposals/plan.md:162-164` (with `findings.md:56` as the corroborating spike signal), and restate the payload in §Key Discoveries / A5 as: *"guards against wholesale replacement of the pool with unmeasured cuisines; the zero-results-at-depth protection is `MAX_OFFSET = 20`, already pinned by `OFFSET_MAX`."*
  - Strength: Preserves the drive-by's real value while making the citation survive a reader who checks it.
  - Tradeoff: A5's "it is not tidying" justification weakens — the change becomes drift-protection rather than a direct risk-#5 gate. It remains defensible on the mirror-test grounds alone.
  - Confidence: HIGH — `findings.md` was read in full; the six-cuisine list appears only at `:56` in the stated hedged form, and the offset-50 measurement is verbatim in the 2026-07-20 plan.
  - Blind spot: None significant.
- **Decision**: FIXED via the single Fix — the §Oracle constants source cell, the §Key Discoveries bullet, A5, and Phase 2 change #4 all now cite `context/archive/2026-07-20-cold-start-proposals/plan.md:162-164` (with `findings.md:56` as corroboration) and restate the payload as drift protection against wholesale pool replacement, naming `MAX_OFFSET = 20` / `OFFSET_MAX` as the actual zero-results-at-depth guard.

### F6 — Phase 3's "Automated Verification" is not automatable

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 → Success Criteria → Automated Verification, bullet 2; Progress 3.2
- **Detail**: The bullet reads *"§3 Phase 1 Status reads `complete` and both change folders are listed: `npm run lint`."* `npm run lint` is `eslint .`; it does not read markdown prose, so no command in the repo can verify this claim. `/10x-implement` will tick 3.2 against a command that returns success regardless of whether the edit was made. (The Phase 2 analogue — *"the now-unused import removed: `npm run lint`"* — is legitimate: `eslint` does flag the unused `CUISINES` binding.)
- **Fix**: Move the bullet from Automated to Manual Verification and phrase it as a reader check ("§3 Phase 1 Status cell reads `complete`; the Change folder cell lists both slices without the `(#1, shipped)` qualifier"); renumber Progress so 3.2 sits under `#### Manual`. Keep `npm test` as Phase 3's sole automated criterion.
  - Strength: Removes a criterion that would be ticked without being checked, in a phase whose entire output is prose.
  - Tradeoff: Phase 3 is left with one automated criterion — accurate for a documentation phase.
  - Confidence: HIGH — `package.json` and `.github/workflows/ci.yml` both read; `lint` is `eslint .` with no markdown plugin in the pipeline.
  - Blind spot: None significant.
- **Decision**: FIXED via the single Fix — the bullet moved to Phase 3 Manual Verification and rephrased as a reader check (Status cell `complete`; Change folder cell lists both slices without the `(#1, shipped)` qualifier). Phase 3's Automated section is now `npm test` alone; Progress renumbered so 3.1 is the sole automated item and 3.2–3.5 are manual.

### F7 — Phase 2 change #5 has no mutation only it can catch

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 2 → Changes Required #5 ("Persisted rows carry the pin unchanged"); Phase 2 → Manual Verification bullet 4
- **Detail**: Its listed mutation — *"Make the endpoint default `requested_cuisine` to a constant when null"* — would also redden Phase 1 change #4's provenance test **and** the already-shipped assertion at `src/pages/api/__tests__/proposals.test.ts:290` (`expect(rows.map((row) => row.requested_cuisine)).toEqual([null, null, "thai", "french"])`). Applying the plan's own §Lean Execution question ("if I removed this, would the end state still be achievable?"), the answer is yes for every listed end-state item. The genuine marginal coverage is narrow but real: it is the only persistence assertion driven through the **cold-start** branch (`buildColdStartSet`), and US-02 binds cold start specifically.
- **Fix A ⭐ Recommended**: Keep it, and give it a mutation only it kills — e.g. *"dedupe the `proposals` insert rows by `spoonacular_id` in `persist()` (`src/pages/api/proposals.ts:196`) → the persisted-pin test goes red"* — and re-describe its intent as "the cold-start branch reaches `persist()` with its per-recipe pins intact," distinguishing it from Phase 1 change #4's personalized-branch coverage.
  - Strength: Converts an overlapping test into a distinct one at no extra structural cost, and covers the one endpoint branch nothing else in the file exercises for persistence.
  - Tradeoff: One more mutation check in the human-confirmation pause at the end of Phase 2.
  - Confidence: MEDIUM — the overlap is verified; whether the proposed collapse mutation is the *best* unique kill was not compared against alternatives.
  - Blind spot: Whether a cold-start persistence path has any behaviour the personalized path lacks beyond the branch itself.
- **Fix B**: Drop change #5 and add a cold-start-driven case to Phase 1 change #4 instead (same file, same `describe`, one extra `it`).
  - Strength: One fewer test, one fewer mutation check, both branches still covered; the plan gets leaner where it is thickest.
  - Tradeoff: Mixes a #5-framed assertion into the #4 phase, so Phase 2's "DB-side face of #5" story disappears from the plan's narrative.
  - Confidence: MEDIUM — coverage-equivalent, but it blurs the risk-per-phase framing the plan is built on.
  - Blind spot: Whether Phase 3's cookbook note leans on the #5-has-a-DB-face framing.
- **Decision**: FIXED via Fix A — Phase 2 change #5's intent now names the cold-start branch as its distinct coverage (the branch US-02 binds and nothing else exercises for persistence), its contract adds "one row per proposal (no dedupe or collapse)", and Manual Verification bullet 4 was replaced with the dedupe-by-`spoonacular_id` mutation at `src/pages/api/proposals.ts:196` — a kill no other test shares.

### F8 — `dirtyFullSet()` is specified two incompatible ways

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 → Changes Required #1 (Contract) vs. #4 (Contract)
- **Detail**: Change #1 specifies *"a `dirtyFullSet()` **mirroring `fullSet()`** (slots 1/2 with `requestedCuisine: null`, slots 3/4 pinned)."* The existing `fullSet()` (`src/pages/api/__tests__/proposals.test.ts:113-115`) pins slot 3 to `"thai"`. Change #4 then requires *"slots 3/4 [pinned] to cuisines that are **not** `"thai"`"* while every recipe carries `cuisines: ["thai"]` — the contradiction that makes the test sharp. An implementer following #1 literally builds the fixture with `"thai"` at slot 3 and then finds #4's "is never `"thai"`" assertion unsatisfiable.
- **Fix**: Amend change #1's contract to name the pins explicitly — e.g. *"`dirtyFullSet()`: slots 1/2 `requestedCuisine: null`, slot 3 pinned `"italian"`, slot 4 pinned `"french"` — deliberately **not** `"thai"`, which is the value every recipe's `cuisines[]` carries (see change #4)."*
  - Strength: Removes the only ambiguity an implementer would have to resolve by guessing; both pins stay inside `VERIFIED_CUISINES`.
  - Tradeoff: None.
  - Confidence: HIGH — `fullSet()` was read; slot 3 is `"thai"`.
  - Blind spot: None significant.
- **Decision**: FIXED via the single Fix — Phase 1 change #1's contract now says `dirtyFullSet()` mirrors `fullSet()`'s *shape* but not its pins, and names them: slots 1/2 `null`, slot 3 `"italian"`, slot 4 `"french"` — explicitly not `"thai"`, cross-referenced to change #4's assertion. Both pins are `VERIFIED_CUISINES` members.

### F9 — The wire projection gains no key-set assertion in a file that is establishing exactly that shape

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 (scope); §What We're NOT Doing
- **Detail**: `src/pages/api/proposals.ts:28-31` documents a third narrowing point the plan itself names in §Key Discoveries — *"sanitized excerpt only — the raw HTML `summary` never crosses to the client"* — and research §Architecture Insights lists `toPayload` beside `toCandidate` and the upsert map as the three hand-written literals carrying the whole FR-011 / no-macros burden. The plan asserts closed key sets at the other two and leaves `toPayload` alone. Nothing in the suite currently asserts the payload's key set either: the existing hydration test (`:243-267`) uses `toMatchObject`, which is open by construction, so a `summary: recipe.summary` added to `toPayload` (`:57-69`) ships raw provider HTML plus inline macro figures to the client with the full suite green. This is arguably risk #6 (rollout Phase 2, component/integration) rather than #4 — but the assertion is one line in a file this phase already edits, using the shape the phase already introduces. The gap is currently neither covered nor recorded.
- **Fix**: Either add to Phase 1 change #3 an assertion that `Object.keys(body.proposals[0]).sort()` equals a local `PAYLOAD_FIELDS` oracle (the eleven `ProposalPayload` members, cited to the wire contract at `src/pages/api/proposals.ts:33-49`), or add a bullet to §What We're NOT Doing recording that the third narrowing point is deliberately left to rollout Phase 2 / risk #6 so it is not re-discovered as an oversight.
  - Strength: Closes the last of the three projections the plan's own architecture note identifies, or at minimum leaves an explicit trail; the dirty fixture needed to make it fail already exists in this phase.
  - Tradeoff: The assertion is #6-shaped in a #4/#5 slice, and it would need updating whenever the wire contract legitimately gains a field — a maintenance cost the storage oracles do not carry, since FR-011's triple is fixed by licence.
  - Confidence: HIGH — `toMatchObject` at `:261-264` is open; no key-set assertion on the payload exists anywhere in the suite.
  - Blind spot: Whether rollout Phase 2's component tests already plan to own this assertion at the render layer instead.
- **Decision**: FIXED via the single Fix, record-it branch — added a §What We're NOT Doing bullet naming `toPayload` (`src/pages/api/proposals.ts:57-69`) as the third narrowing point, the open `toMatchObject` gap at `:243-267`, and the deferral to rollout Phase 2 / risk #6. Took the record over the assertion because the finding itself classes it as #6-shaped in a #4/#5 slice and flags a maintenance cost the licence-fixed storage oracles do not carry.
