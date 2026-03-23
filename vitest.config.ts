import { defineConfig } from "vitest/config";

/**
 * English regression: validates deal-quality rules on English copy only.
 * Run: npm run test:english
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.english-regression.test.ts"],
    passWithNoTests: false,
  },
});
