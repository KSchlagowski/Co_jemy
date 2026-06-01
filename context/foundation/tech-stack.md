---
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
---

## Why this stack

A solo developer shipping the "Co jemy?" meal-proposal MVP in 3 after-hours weeks needs a battle-tested, agent-friendly starter that handles auth and a reliable database out of the box — the rating history that powers the whole 4-slot proposal loop must persist without custom infra work. Astro + Supabase + Cloudflare is the recommended default for `(web, js)` and clears all four agent-friendly gates (typed, convention-based, popular in training data, well-documented). Supabase delivers email+password auth (FR-001/002) and Postgres persistence for ratings (the PRD guardrail) directly; the AI-powered web search (FR-003) is an external API wired in on top, independent of starter choice. Bootstrapper confidence is first-class, so scaffolding should be mostly smooth with the occasional manual step. Auth and AI feature flags are set; payments, realtime, and background jobs are out of scope per the PRD. Deployment targets Cloudflare Pages (the starter default) with GitHub Actions and auto-deploy-on-merge — the shape the starter ships with.
