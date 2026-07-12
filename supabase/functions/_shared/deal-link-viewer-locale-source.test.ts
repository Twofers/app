import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "deal-link", "index.ts"),
  "utf8",
);

describe("deal-link viewer-language source guards", () => {
  it("resolves viewer locale and renders localized public-safe deal copy", () => {
    expect(source).toMatch(/resolveViewerLocaleFromRequest/);
    expect(source).toMatch(/buildPublicDealDisplay/);
    expect(source).toMatch(/localeHtmlLang/);
    expect(source).toMatch(/PUBLIC_DEAL_LOCALIZED_SELECT/);
    expect(source).not.toMatch(/getDealDisplayTitle/);
    expect(source).not.toMatch(/<html lang="en">/);
    expect(source).not.toMatch(/Limited-time local offer available now at/);
    expect(source).not.toMatch(/Open in Twofer\s*</);
  });
});
