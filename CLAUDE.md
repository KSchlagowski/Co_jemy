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

## 10xDevs AI Toolkit - Module 2, Lesson 2

Turn one roadmap item into the first implementation cycle with the **change planning chain**:

```
/10x-roadmap -> /10x-new -> /10x-plan -> /10x-plan-review -> /10x-implement
```

`/10x-new`, `/10x-plan`, `/10x-plan-review`, and `/10x-implement` are the lesson focus. `/10x-frame` and `/10x-research` are not required rituals here; they are escalation paths introduced in the next lesson.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Change setup (lesson focus)** | |
| `/10x-new <change-id>` | You selected a roadmap item and need a stable change folder. Creates `context/changes/<change-id>/change.md` so planning, implementation, progress, commits, and later review all share one identity. Use AFTER roadmap selection, BEFORE `/10x-plan`. |
| **Planning (lesson focus)** | |
| `/10x-plan <change-id>` | You have a change folder and need a reviewable implementation plan. Reads roadmap context, foundation docs, codebase evidence, and any existing change notes; writes `plan.md` and `plan-brief.md` with phases, file contracts, success criteria, and `## Progress`. |
| **Plan readiness (lesson focus)** | |
| `/10x-plan-review <change-id>` | You have `plan.md` and need a light pre-code readiness check. Use it to catch missing end state, weak contracts, malformed progress, scope drift, or blind spots before code changes begin. |
| **Implementation (lesson focus)** | |
| `/10x-implement <change-id> phase <n>` | You have an approved plan and want to execute one phase with verification, manual gate, commit ritual, and SHA write-back to `## Progress`. |
| **Lifecycle closure** | |
| `/10x-archive <change-id>` | A change is merged or intentionally closed. Move it out of active `context/changes/` into archive state. |

### How the chain hands off

- `/10x-new` creates the durable change identity.
- `/10x-plan` turns that identity into an implementation contract.
- `/10x-plan-review` checks the plan before the agent mutates code.
- `/10x-implement` executes one planned phase, verifies, asks for manual confirmation when needed, commits, and records progress.

### Lesson boundaries

- Plan is the default router after roadmap selection. Start with `/10x-plan` unless the problem is unclear or external evidence is blocking.
- Do not run `/10x-frame + /10x-research` as ceremony for every change.
- Do not turn this lesson into a full end-to-end product build. A checkpoint with a planned and partially or fully implemented stream is valid.
- Code review of the implemented diff belongs to Lesson 3 via `/10x-impl-review`.
- Lifecycle closure via `/10x-archive` after a change is merged or intentionally closed.

### Paths used by this lesson

- `context/foundation/roadmap.md` - upstream roadmap
- `context/changes/<change-id>/change.md` - change identity
- `context/changes/<change-id>/plan.md` - implementation contract
- `context/changes/<change-id>/plan-brief.md` - compressed handoff
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
