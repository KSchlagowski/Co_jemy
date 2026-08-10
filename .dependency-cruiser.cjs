/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "Circular dependencies make code hard to reason about and can break module initialization.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "Module is not depended upon and depends on nothing - likely dead code.",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$", // dotfiles
          "\\.d\\.ts$",
          "(^|/)tsconfig\\.json$",
          "(^|/)(babel|webpack)\\.config\\.(js|cjs|mjs|ts|json)$",
          "^src/pages/", // Astro file-based routes are entry points
          "^src/middleware\\.ts$",
          "^src/env\\.d\\.ts$",
        ],
      },
      to: {},
    },
    {
      name: "no-deprecated-core",
      severity: "error",
      from: {},
      to: { dependencyTypes: ["core"], path: ["^(punycode|domain|sys|util\\.promisify)$"] },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment: "Dependency cannot be resolved - typo or missing package.",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-duplicate-dep-types",
      severity: "warn",
      from: {},
      to: { moreThanOneDependencyType: true, dependencyTypesNot: ["type-only"] },
    },
    {
      name: "not-to-dev-dep",
      severity: "error",
      comment: "Production source must not depend on a devDependency.",
      from: { path: "^src", pathNot: "\\.(spec|test)\\.(ts|tsx)$" },
      to: { dependencyTypes: ["npm-dev"], dependencyTypesNot: ["type-only"] },
    },
    {
      name: "no-test-in-src",
      severity: "error",
      comment: "Application code must not import test files.",
      from: { path: "^src", pathNot: "\\.(spec|test)\\.(ts|tsx)$" },
      to: { path: "\\.(spec|test)\\.(ts|tsx)$" },
    },
    {
      name: "no-non-package-json",
      severity: "error",
      comment: "Dependency is used but not declared in package.json.",
      from: {},
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
  ],
  options: {
    doNotFollow: { path: ["node_modules"] },
    // `astro:*` are virtual modules injected by Astro - they never resolve on disk.
    exclude: {
      path: ["^dist/", "^\\.astro/", "^playwright-report/", "^test-results/", "^astro:"],
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"],
      extensions: [".js", ".mjs", ".cjs", ".ts", ".tsx", ".d.ts", ".astro"],
    },
    cache: { folder: "node_modules/.cache/dependency-cruiser", strategy: "metadata" },
    progress: { type: "cli-feedback" },
    reporterOptions: {
      dot: { collapsePattern: "^(src/(components|layouts|lib|pages|styles))" },
      archi: {
        collapsePattern: "^(src/[^/]+)",
      },
      text: { highlightFocused: true },
    },
  },
};
