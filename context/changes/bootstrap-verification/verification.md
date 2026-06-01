---
bootstrapped_at: 2026-06-01T19:45:51Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: Co_jemy
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

Verbatim copy of `context/foundation/tech-stack.md` consumed for this run.

**Frontmatter:**

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: Co_jemy
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

**## Why this stack:**

A solo developer shipping the "Co jemy?" meal-proposal MVP in 3 after-hours weeks needs a battle-tested, agent-friendly starter that handles auth and a reliable database out of the box — the rating history that powers the whole 4-slot proposal loop must persist without custom infra work. Astro + Supabase + Cloudflare is the recommended default for `(web, js)` and clears all four agent-friendly gates (typed, convention-based, popular in training data, well-documented). Supabase delivers email+password auth (FR-001/002) and Postgres persistence for ratings (the PRD guardrail) directly; the AI-powered web search (FR-003) is an external API wired in on top, independent of starter choice. Bootstrapper confidence is first-class, so scaffolding should be mostly smooth with the occasional manual step. Auth and AI feature flags are set; payments, realtime, and background jobs are out of scope per the PRD. Deployment targets Cloudflare Pages (the starter default) with GitHub Actions and auto-deploy-on-merge — the shape the starter ships with.

## Pre-scaffold verification

Light, read-only recency check. WARN-AND-CONTINUE — never gating.

| Signal      | Value                                                   | Severity | Notes                                                         |
| ----------- | ------------------------------------------------------- | -------- | ------------------------------------------------------------ |
| npm package | not run                                                 | —        | `cmd_template` starts with `git clone`; no `create-*` CLI to resolve |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-05-17 | fresh    | from card `docs_url`; ~2 weeks before run (within 3-month window) |

No stale signals. Proceeded normally.

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone (clone the starter repo, discard its git history, move files up)
**Exit code**: 0
**Files moved**: 20 (18 silent + 2 sidelined)
**Conflicts (.scaffold siblings)**: CLAUDE.md → CLAUDE.md.scaffold, README.md → README.md.scaffold
**.gitignore handling**: moved silently (cwd had no `.gitignore`)
**.bootstrap-scaffold cleanup**: deleted (cloned `.git/` removed before move-up; temp dir removed after)

**Files moved up into cwd** (silent — no cwd clash):
`.env.example`, `.github/`, `.gitignore`, `.husky/`, `.nvmrc`, `.prettierrc.json`, `.vscode/`, `astro.config.mjs`, `components.json`, `eslint.config.js`, `node_modules/`, `package-lock.json`, `package.json`, `public/`, `src/`, `supabase/`, `tsconfig.json`, `wrangler.jsonc`

**Preserved in cwd (conflict policy):**
- `context/` — never touched (source of truth for the bootstrap chain; scaffold shipped nothing under it anyway)
- `CLAUDE.md`, `README.md` — existing files kept; scaffold copies sidelined as `.scaffold` siblings
- `LICENSE`, `Co_jemy_MVP.md`, `.claude/`, `skills-lock.json`, `.git/` — pre-existing, no scaffold clash

**Install note**: `npm install` added 773 packages (audited 774). An `EBADENGINE` warning fired — local npm is `8.3.0` while `astro@6.3.1` wants `npm >=9.6.5` (Node `v24.14.0` satisfies `node >=22.12.0`). Non-fatal; consider upgrading npm before heavy use.

## Post-scaffold audit

**Tool**: `npm audit --json` (run from cwd)
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW (total 10)
**Direct vs transitive**: 0/0/2/0 direct of total 0/1/9/0 — the single HIGH and the only non-direct moderates are transitive; 2 moderate findings are direct (`@astrojs/check`, `wrangler`)
**Dependency tree**: 895 total (prod 449, dev 316, optional 131)
**Audit exit code**: informational only; not gating.

#### CRITICAL findings

None.

#### HIGH findings

- **devalue** (transitive), range `5.6.3 - 5.8.0` — "Svelte devalue: DoS via sparse array deserialization". Fix available (`npm audit fix`). Reaches the tree via Astro's internals.

#### MODERATE findings (log-only)

- **@astrojs/check** (direct), range `>=0.9.3` — via `@astrojs/language-server`. Fix requires downgrade to `@astrojs/check@0.9.2` (flagged semver-major).
- **wrangler** (direct), range `<=0.0.0-kickoff-demo || 3.108.0 - 4.93.0` — via `miniflare`. Fix available.
- **@astrojs/language-server** (transitive) — via `volar-service-yaml`. Fix via `@astrojs/check@0.9.2` (major).
- **@cloudflare/vite-plugin** (transitive) — via `miniflare`, `wrangler`, `ws`. Fix available.
- **miniflare** (transitive) — via `ws`. Fix available.
- **volar-service-yaml** (transitive) — via `yaml-language-server`. Fix via `@astrojs/check@0.9.2` (major).
- **ws** (transitive), range `8.0.0 - 8.20.0` — "ws: Uninitialized memory disclosure". Fix available.
- **yaml** (transitive), range `2.0.0 - 2.8.2` — "yaml is vulnerable to Stack Overflow via deeply nested YAML collections". Fix via `@astrojs/check@0.9.2` (major).
- **yaml-language-server** (transitive) — via `yaml`. Fix via `@astrojs/check@0.9.2` (major).

#### LOW / INFO findings

None.

> bootstrapper informs; it does not auto-patch. Most findings clear with `npm audit fix`; the `@astrojs/check` chain wants a semver-major change (`npm audit fix --force`) — review before applying.

## Hints recorded but not acted on

Every hint carried in the hand-off that v1 logged without acting on. The future M1L4 ("Memory Architecture") skill can consume these without a schema bump.

| Hint                    | Value                  |
| ----------------------- | ---------------------- |
| bootstrapper_confidence | first-class            |
| quality_override        | false                  |
| path_taken              | standard               |
| self_check_answers      | null                   |
| team_size               | solo                   |
| deployment_target       | cloudflare-pages       |
| ci_provider             | github-actions         |
| ci_default_flow         | auto-deploy-on-merge   |
| has_auth                | true                   |
| has_payments            | false                  |
| has_realtime            | false                  |
| has_ai                  | true                   |
| has_background_jobs     | false                  |

`bootstrapper_confidence: first-class` — scaffolding expected to be smooth; no compensation needed. `quality_override: false` — no quality gate was bypassed during stack selection. No automated action taken on any row in v1.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep (`CLAUDE.md.scaffold`, `README.md.scaffold`).
- Address audit findings per your project's risk tolerance — the full breakdown is above. `npm audit fix` clears most; the `@astrojs/check` chain needs a reviewed semver-major change.
- Consider upgrading local npm (`8.3.0` → `>=9.6.5`) to clear the `EBADENGINE` warning Astro emits.
- Configure Supabase RLS early (per the starter's gotchas) so auth gaps don't creep in.
