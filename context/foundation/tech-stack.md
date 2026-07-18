---
starter_id: 10x-astro-starter
package_manager: npm
project_name: Co_jemy
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-workers
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
---

## Why this stack

A solo developer shipping the "Co jemy?" meal-proposal MVP in 3 after-hours weeks needs a battle-tested, agent-friendly starter that handles auth and a reliable database out of the box — the rating history that powers the whole 4-slot proposal loop must persist without custom infra work. Astro + Supabase + Cloudflare is the recommended default for `(web, js)` and clears all four agent-friendly gates (typed, convention-based, popular in training data, well-documented). Supabase delivers email+password auth (FR-001/002) and Postgres persistence for ratings (the PRD guardrail) directly; recipe retrieval (FR-003) is the Spoonacular Food API, a plain REST endpoint called with global `fetch` and wired in on top, independent of starter choice. Bootstrapper confidence is first-class, so scaffolding should be mostly smooth with the occasional manual step. The auth feature flag is set; AI, payments, realtime, and background jobs are out of scope per the PRD. Deployment targets Cloudflare Workers (via the `@astrojs/cloudflare` adapter and `wrangler deploy` — the adapter dropped Pages support) with GitHub Actions and auto-deploy-on-merge.

> **Revised 2026-07-18.** Retrieval was originally specified as live AI-powered web search, and `has_ai` was set accordingly. The pivot to Spoonacular removes AI from the stack entirely: no model provider, no SDK, no `nodejs_compat` exposure — one authenticated REST call. `has_ai` is now `false`. This is a net simplification of the stack; the cost is a new external dependency with a metered free tier (50 points/day) and contractual limits on what recipe data may be stored. See PRD FR-003, FR-010, FR-011.
