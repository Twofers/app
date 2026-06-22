import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-business-lookup", "index.ts"),
  "utf8",
);

describe("ai-business-lookup source guards", () => {
  it("does not log raw Google lookup or outer handler exception text", () => {
    expect(source).toMatch(/GOOGLE_PLACES_SEARCH_EXCEPTION/);
    expect(source).toMatch(/GOOGLE_PLACE_DETAILS_EXCEPTION/);
    expect(source).toMatch(/BUSINESS_LOOKUP_SERVER_ERROR/);
    expect(source).not.toMatch(/err:\s*String\(err\)/);
    expect(source).not.toMatch(/logLookup\("server_error",\s*\{\s*err:/);
  });
});
