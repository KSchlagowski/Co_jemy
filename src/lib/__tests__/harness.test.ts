import { describe, it, expect } from "vitest";
import { CUISINES, pickCuisinePair } from "@/lib/proposals";

// Smoke test for the runner itself. Importing `@/lib/proposals` transitively imports
// `astro:env/server` (via `@/lib/spoonacular`), so a green run proves three things at
// once: Vitest works, the `@/` alias resolves, and the `astro:env` virtual module is
// resolvable under getViteConfig. If this import fails, apply the astro:env fallback in
// the plan's Critical Implementation Details.
describe("test harness", () => {
  it("resolves the @/ alias and the astro:env module graph", () => {
    expect(CUISINES.length).toBeGreaterThan(1);
  });

  // Loop rather than seed: the distinct-pair invariant must hold across every seed.
  it("pickCuisinePair returns two distinct known cuisines", () => {
    for (let i = 0; i < 30; i++) {
      const [first, second] = pickCuisinePair();
      expect(first).not.toBe(second);
      expect(CUISINES).toContain(first);
      expect(CUISINES).toContain(second);
    }
  });
});
