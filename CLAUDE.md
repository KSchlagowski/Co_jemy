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

## 10xDevs AI Toolkit - Module 2, Lesson 4

Prepare for a harder implementation stream with the **research-backed planning chain**:

```
internal research (/10x-research) + external research (exa.ai, Context7) -> /10x-plan -> /10x-implement -> success
```

The lesson focus is distinguishing internal from external research and using evidence to back planning decisions.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Internal research (lesson focus)** | |
| `/10x-research <change-id>` | You need evidence from the existing codebase — patterns, conventions, integration points, or existing implementations. Runs parallel sub-agents over the repo and writes structured findings to `research.md`. |
| **External research (lesson focus)** | |
| exa.ai | You need AI-native web search for library comparisons, best practices, or ecosystem context that the codebase cannot answer. |
| Context7 (`resolve-library-id` → `get-library-docs`) | You need live, current documentation for a specific library or framework. Resolves a library ID first, then fetches relevant doc pages. |
| **Framing spare wheel** | |
| `/10x-frame <change-id>` | The plan won't converge, the plan doesn't deliver expected results, or persistent drift keeps breaking the implementation. Use as an escape hatch on a separate problem (demonstrated on Space Explorers example), not as pre-research ritual. |
| **Planning and execution** | |
| `/10x-plan <change-id>` / `/10x-implement <change-id> phase <n>` | Use the same planning and execution chain from Lesson 2, now with upstream research evidence feeding the plan. |

### Research discipline

- Internal research (`/10x-research`) answers "what does our codebase already do?" — patterns, schemas, conventions, integration points.
- External research (exa.ai, Context7) answers "what should we do?" — library capabilities, API docs, ecosystem best practices.
- Combine both as evidence-backed input to `/10x-plan`. A plan without research evidence on a non-trivial stream is a guess.
- Agent-friendly docs (`llms.txt`, markdown-for-agents, `/md` endpoints) are a quality signal for library selection — libraries that publish agent-readable docs integrate faster.

### `/10x-frame` as spare wheel

Three triggers for reaching for `/10x-frame`:
1. The plan won't converge — research keeps opening more questions instead of narrowing to a contract.
2. The plan doesn't deliver — implementation repeatedly fails to meet success criteria.
3. Persistent drift — the implementation keeps diverging from the plan in ways that suggest the problem was mis-framed.

Demonstrated on a Space Explorers example, not the SRS path. It is an escape hatch, not a mandatory step.

### Paths used by this lesson

- `context/changes/<change-id>/research.md` - internal research output
- `context/changes/<change-id>/frame.md` - framing output when needed
- `context/changes/<change-id>/plan.md` - evidence-backed implementation contract
- `context/foundation/lessons.md` - recurring rules and pitfalls

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
