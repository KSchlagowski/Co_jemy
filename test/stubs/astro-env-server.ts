// Test-only stand-in for the `astro:env/server` virtual module. The real module is
// provided by Astro's Vite plugin, which cannot be loaded in the unit runner because
// the Cloudflare adapter's Vite plugin rejects getViteConfig's SSR externals. Reading
// from process.env keeps the key controllable per-test (vitest.setup sets a dummy value;
// Phase 3 can force the empty-key branch via vi.stubEnv + resetModules).
export const SPOONACULAR_API_KEY = process.env.SPOONACULAR_API_KEY ?? "";
