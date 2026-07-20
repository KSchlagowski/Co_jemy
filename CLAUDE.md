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

## 10xDevs AI Toolkit - Module 2, Lesson 3

Review AI-generated code before merge with the **implementation review chain**:

```
/10x-implement -> /10x-impl-review -> triage -> (/10x-lesson | fix | skip | disagree)
```

`/10x-impl-review` is the lesson focus. Review is a quality gate, not an instruction to fix every finding.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Code review (lesson focus)** | |
| `/10x-impl-review <change-id>` | You have implemented code and want a structured review before merge. The skill checks plan adherence, scope discipline, safety and quality, architecture, pattern consistency, and success criteria, then presents findings for triage. |
| **Recurring lesson outcome** | |
| `/10x-lesson` | A finding reveals a recurring project rule or agent failure pattern. Record it in `context/foundation/lessons.md` instead of treating it as a one-off note. |

### Triage discipline

- Severity says how bad the finding is. Impact says how much the decision matters now.
- Valid outcomes: fix now, fix differently, skip, accept as risk, record as recurring rule (`/10x-lesson`), disagree.
- Fix critical findings. Do not burn hours on low-impact observations just because the agent found them.
- Conscious skipping of low-impact findings is a valid review outcome, not negligence.
- If you disagree with a finding, record why. Wrong agent reasoning is also signal.

### Review boundaries

- This lesson reviews implemented code. It does not create the plan, execute new phases, or teach CI review.
- Testing strategy and quality gates are introduced in Module 3.
- Do not use `/10x-contract` as a triage outcome in this lesson.

### Paths used by this lesson

- `context/changes/<change-id>/plan.md` - expected implementation contract
- `context/changes/<change-id>/reviews/` - review output
- `context/foundation/lessons.md` - recurring lessons

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
