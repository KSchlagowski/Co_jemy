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

  // The imported `CUISINES` is deliberate here and is NOT the diversity oracle: this file
  // proves the module graph resolves, so importing the real constant is the point. The
  // mirror-free oracle that pins the six *measured* cuisines lives in `proposals.test.ts`
  // (`VERIFIED_CUISINES`) — a wholesale pool replacement is caught there, not here.
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
