# CLAUDE.md

## Project: Co jemy? — personalized recipe proposer

Astro 6 (SSR) + React 19 + Tailwind 4 + Supabase, deployed to Cloudflare Workers.
Recipes come from the **Spoonacular Food API** (free plan) — not AI web search, and not our own content.
Product spec: @context/foundation/prd.md · Stack rationale: @context/foundation/tech-stack.md

### Commands
- `npm run dev` — local Astro dev server
- `npm run build` — production build. Run `npm run astro sync` first if types go stale (CI does `astro sync` before lint/build; it is not automatic locally).
- `npm run lint` / `npm run lint:fix` · `npm run format` (Prettier)

### Conventions & gotchas
- **React 19 compiler is mandatory** — ESLint sets `react-compiler/react-compiler: "error"`. Don't write code the compiler rejects (no conditional hooks, no manual memo hacks that fight it).
- **Import alias**: use `@/` for anything under `src/` (e.g. `@/lib/supabase`), not relative `../../`.
- **Env vars**: `SUPABASE_URL` and `SUPABASE_KEY` required to build (see `.env.example`). `SPOONACULAR_API_KEY` is needed once recipe retrieval lands — server-side only, never exposed to the client; not yet declared in `astro.config.mjs`.
- **Spoonacular rules that bind the schema** (PRD FR-010/FR-011, provider terms): store only recipe `id`, `title`, and `image` URL — never ingredients, instructions, nutrition, or the `summary`, in any derived form. Every card must credit the publisher (`sourceName`) and link to `sourceUrl`, not `spoonacularSourceUrl`. Free plan is 50 points/day and returns HTTP 402 when spent. **Call count dominates the budget, not result count** — each call costs 1 point of base plus only ~0.035/recipe returned. So use the fewest cuisine-pinned `complexSearch` calls that satisfy the diversity rule (one per requested cuisine), never one per slot, and over-fetch results within a call rather than adding calls.
- **Cloudflare SSR**: runs on the Cloudflare adapter — no Node-only APIs in server code.
- **Pre-commit** (Husky + lint-staged) auto-fixes TS/TSX/Astro lint and reformats JSON/CSS/MD on commit.
- Auth = email/password via Supabase; API endpoints live in `src/pages/api/auth/`.

### Foundation docs

- `@context/foundation/prd.md` — product spec · `@context/foundation/tech-stack.md` — stack rationale
- `@context/foundation/lessons.md` — recurring-rule register (append-only; consumed by planning/review skills)
- 10x AI Toolkit usage & skill chain: `@docs/10x-toolkit.md`

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 3, Lesson 4 (E2E Tests)

**For E2E tests, use the `/10x-e2e` skill.** It is the single source of truth
for the workflow — risk → seed test + rules → generate → review against the five
anti-patterns → re-prompt → verify. The skill's `references/` carry the full
rules, anti-patterns, seed pattern, and prompt-template.

A few hard rules that hold even before you invoke the skill:

- **Locators:** `getByRole` / `getByLabel` / `getByText` first; `getByTestId`
  only when accessibility attributes are ambiguous. Never CSS selectors, XPath,
  or DOM structure.
- **Never `page.waitForTimeout()`.** Wait for state: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- **Test independence + cleanup.** Each test runs standalone — its own setup,
  action, assertion, and cleanup; unique ids (timestamp suffix) so parallel runs
  and re-runs don't collide.

Two boundaries to keep straight:

- **DOM (snapshot) is the default.** Vision (`--caps=vision`) is a supplement for
  visual-only risks (layout, z-index, animation); for pixel regression prefer
  deterministic tools (`toMatchSnapshot`, Argos, Lost Pixel). VLM model
  selection/cost is a debugging topic (Lesson 5), not testing.
- **Healer helps on selectors, harms on logic.** A changed selector → healer
  re-finds it (route through PR review). A changed business behavior → healer
  masks the bug; that failing-test-to-fix case is Lesson 5.

<!-- END @przeprogramowani/10x-cli -->
