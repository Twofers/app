import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "weekly-deal-digest", "index.ts"),
  "utf8",
);

describe("weekly deal digest source guards", () => {
  it("counts only deals whose customer-visible window has started", () => {
    expect(source).toMatch(/\.eq\("is_active", true\)/);
    expect(source).toMatch(/\.lte\("start_time", nowIso\)/);
    expect(source).toMatch(/\.gte\("end_time", nowIso\)/);
  });
});
