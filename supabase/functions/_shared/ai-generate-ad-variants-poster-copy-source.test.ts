import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-generate-ad-variants", "index.ts"),
  "utf8",
);

describe("ai-generate-ad-variants poster copy source guard", () => {
  it("rejects poster headlines that start with Try our or repeat the locked offer", () => {
    expect(source).toContain("function posterHeadlineGateReasons");
    expect(source).toContain("POSTER_HEADLINE_TRY_OUR");
    expect(source).toContain("POSTER_HEADLINE_REPEATS_LOCKED_OFFER");
    expect(source).toContain('params.creativeFormat === "poster_v1"');
    expect(source).toContain("posterHeadlineGateReasons(variant, params.offerContract)");
    expect(source).toContain("...posterReasons");
    expect(source).toContain("creativeFormat,");
  });
});
