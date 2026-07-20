<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Spoonacular Retrieval & Quota Spike

- **Plan**: context/changes/spoonacular-retrieval-spike/plan.md (carried over from context/archive/2026-07-16-spoonacular-retrieval-spike/)
- **Scope**: Full plan (Phases 1–3 of 3)
- **Date**: 2026-07-19
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 7 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success criteria re-verified 2026-07-19: `astro sync`, `npm run lint`, `npm run build` all pass; `src/pages/api/spike/` absent; `git grep -ri spike -- src/` empty; CI deploy runs covering all three spike commits are green. Manual checkboxes are corroborated by measurements.md / findings.md content (no rubber-stamping detected).

## Findings

### F1 — Unguarded fetch/JSON parse can throw outside the typed result union

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/spoonacular.ts:78 (also :88)
- **Detail**: `fetch(url)` and `response.json()` are not wrapped in try/catch. A network-level failure (DNS, reset, TLS) or a non-JSON 200 body rejects and escapes the `SpoonacularResult` union as an unhandled exception — a generic 500 instead of a typed outcome. This also makes docs/reference/contract-surfaces.md:54 ("the module never logs, throws, or returns a URL containing it") an asserted rather than enforced guarantee; an uncaught exception under Workers observability is the last theoretical apiKey-exposure path (actual leak risk low — Workers fetch TypeErrors don't embed the full URL).
- **Fix**: Wrap fetch + json() in try/catch and return a typed `{ ok: false, reason: "network_error", status: 0 }`; add the reason to the union and update contract-surfaces.md (union + the "never throws" claim).
  - Strength: Closes the reliability gap and makes the documented guarantee true before S-02 builds on this module.
  - Tradeoff: Adds a fourth union variant S-02 must handle — trivial.
  - Confidence: HIGH — self-contained change in one module.
  - Blind spot: None significant.
- **Decision**: FIXED — try/catch around fetch and json() returning typed `network_error`; union + contract-surfaces.md updated (2026-07-19)

### F2 — Additive drift: `not_configured` result variant + 503 mapping not in plan

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/spoonacular.ts:23-31
- **Detail**: Plan specified a two-reason union (`quota_exhausted` | `http_error`); implementation added a third `not_configured` reason (returned when the API key secret is missing) and the spike endpoint mapped it to HTTP 503. Defensive hardening for a missing-key deploy; contract-surfaces.md:51 already documents the three-reason union as the official surface. A second micro-deviation: the ok-branch quota falls back to a `{used:-1,...}` sentinel (see F4).
- **Fix**: Accept — the drift is benign, already reflected in the contract registry, and the endpoint half is deleted.
- **Decision**: ACCEPTED — benign additive hardening, documented in contract-surfaces.md (2026-07-19)

### F3 — SPOONACULAR_API_KEY missing from the config-status registry

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/config-status.ts:11-19
- **Detail**: The repo's config-status registry exists precisely to surface missing configuration, but the new secret was never added to `configStatuses`. A missing key is invisible on the status surface and only manifests as `not_configured` results at call time.
- **Fix**: Add a SPOONACULAR_API_KEY entry to `configStatuses`.
- **Decision**: FIXED — Spoonacular entry added to configStatuses (2026-07-19)

### F4 — Quota telemetry edge cases: `-1` sentinel and empty-header-as-zero

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/spoonacular.ts:39-47, :89
- **Detail**: On the ok path, missing quota headers yield a `{used:-1,request:-1,left:-1}` sentinel that callers must magically know means "unknown" (undocumented in contract-surfaces.md:53). Separately, a present-but-empty header parses as `Number("") === 0` — a silently wrong quota value.
- **Fix**: Make the ok-arm quota optional (`quota?: QuotaInfo`), drop the sentinel, and treat empty headers as missing; update contract-surfaces.md. Best done before S-02 depends on the shape.
- **Decision**: FIXED — ok-arm quota now optional, sentinel dropped, empty headers treated as missing; contract-surfaces.md synced (2026-07-19)

### F5 — Provider payload blind-cast in toCandidate

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/spoonacular.ts:49-59
- **Detail**: `toCandidate` casts raw provider fields without validation (`raw.id as number`); malformed payloads pass through unvalidated. Acceptable for a spike-scoped lib.
- **Fix**: Accept for the spike; note as an S-02 precondition (validate/narrow provider payloads before proposal logic consumes them).
- **Decision**: ACCEPTED — spike-scope OK; queued as S-02 precondition in follow-ups/review-fixes.md (2026-07-19)

### F6 — `offset` provider cap (≤900) documented but not enforced

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/spoonacular.ts:100 (doc: docs/reference/contract-surfaces.md:49)
- **Detail**: contract-surfaces.md states "`offset` ≤ 900 (provider cap)" in a way that reads like a code guarantee, but `searchRecipes` does not clamp; an out-of-range offset becomes a paid-for `http_error` (1 quota point wasted).
- **Fix**: Clamp/validate `offset` ≤ 900 in `searchRecipes` (or reword the doc to mark it caller responsibility).
- **Decision**: FIXED — offset clamped to 0–900 in searchRecipes; contract-surfaces.md updated to state the clamp (2026-07-19)

### F7 — Stale findings.md path in contract-surfaces.md

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: docs/reference/contract-surfaces.md:3
- **Detail**: Cites `context/changes/spoonacular-retrieval-spike/findings.md`; the archive commit (12c5596) moved it to `context/archive/2026-07-16-spoonacular-retrieval-spike/findings.md`. (The reopened change folder makes the old path half-true again, but the findings file itself lives in the archive.)
- **Fix**: Update the citation to the archive path.
- **Decision**: FIXED — citation now points at context/archive/2026-07-16-spoonacular-retrieval-spike/findings.md (2026-07-19)

### F8 — Timing-unsafe token comparison on the (deleted) spike guard

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: N/A (deleted — deea7fd:src/pages/api/spike/spoonacular.ts:18)
- **Detail**: The guard used plain `!==` string comparison (not timing-safe). It did fail closed on unset/empty SPIKE_TOKEN, so exploitability was marginal, and the endpoint is already deleted — moot as code, but a candidate recurring rule: guard tokens on public endpoints should fail closed AND use `crypto.subtle.timingSafeEqual` on Workers.
- **Fix**: No code change (endpoint gone); optionally record as a lesson via /10x-lesson.
- **Decision**: ACCEPTED-AS-RULE: "Guard tokens on public endpoints: fail closed + timing-safe compare" (context/foundation/lessons.md, 2026-07-19). No code fix applicable — the endpoint no longer exists.
