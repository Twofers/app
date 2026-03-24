import { defineConfig } from "vitest/config";

/**
 * All `lib/**/*.test.ts` files (deal-quality regression, locale helpers, discovery filters, etc.).
 * Focused English regression: `npm run test:english`
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    passWithNoTests: false,
  },
});
