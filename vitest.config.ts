import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// getViteConfig() from astro/config is the documented harness, but it loads the full
// Astro config — including the Cloudflare adapter, whose Vite plugin rejects the SSR
// `resolve.external` list getViteConfig injects, so the runner never boots. We instead
// wire the two things the tests actually need — the `@/` alias and the `astro:env/server`
// binding — by hand, and run in the `node` environment Astro 6 requires. No quota is spent:
// every provider call is stubbed at the test layer.
const rootDir = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: [
      { find: /^astro:env\/server$/, replacement: resolve(rootDir, "./test/stubs/astro-env-server.ts") },
      { find: "@", replacement: resolve(rootDir, "./src") },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
