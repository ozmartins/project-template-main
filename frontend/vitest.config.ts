import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      // Thresholds are intentionally set below the current coverage level (~41%)
      // to provide a meaningful floor while allowing for new uncovered files.
      // Do not raise these above the current measured coverage without adding tests first.
      // Current measured: lines ~41%, functions ~40%, branches ~39%, statements ~42%
      // History: CI was red due to threshold drift (issues #577, #721). Fixed in PR #1067
      // by adding ExpressionEvaluator tests and resetting thresholds to reflect reality.
      thresholds: {
        lines: 37,
        functions: 36,
        branches: 34,
        statements: 38,
      },
      exclude: [
        "src/components/ui/**", // shadcn generated components
        "src/routeTree.gen.ts", // auto-generated
        "**/*.test.ts",
        "**/*.test.tsx",
      ],
    },
  },
});
