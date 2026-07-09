import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

// Tests under lib/ (deal-quality regression, locale helpers, discovery filters, etc.).
// Focused English regression: npm run test:english
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "components/**/*.test.ts", "supabase/functions/**/*.test.ts"],
    passWithNoTests: false,
  },
});
