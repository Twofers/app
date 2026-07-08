import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "import-business-website", "index.ts"),
  "utf8",
);

describe("import-business-website source guards", () => {
  it("routes every outbound request through the SSRF-safe fetch wrapper", () => {
    // The only bare fetch( in the file is the one inside safeFetch.
    const bareFetches = source.match(/(?<![.\w])fetch\(/g) ?? [];
    expect(bareFetches.length).toBe(1);
    expect(source).toMatch(/redirect:\s*"manual"/);
    expect(source).toMatch(/AbortSignal\.timeout\(FETCH_TIMEOUT_MS\)/);
  });

  it("re-resolves DNS and blocks private/reserved IPs (incl. on redirects)", () => {
    expect(source).toMatch(/Deno\.resolveDns/);
    expect(source).toMatch(/isPrivateOrReservedIp/);
    // Redirects loop back through validation rather than following automatically.
    expect(source).toMatch(/hostResolvesToPublicIp/);
  });

  it("enforces auth, redeemer block, and a daily rate limit", () => {
    expect(source).toMatch(/auth\.getUser\(\)/);
    expect(source).toMatch(/isRedeemerUser/);
    expect(source).toMatch(/RATE_LIMITED/);
    expect(source).toMatch(/site_import_events/);
  });

  it("logs the AI cost ledger under the site_import feature", () => {
    expect(source).toMatch(/feature:\s*"site_import"/);
  });

  it("never logs raw HTML, full URLs, or upstream bodies", () => {
    // Structured logs carry host + counts only.
    expect(source).toMatch(/tag:\s*"site_import"/);
    expect(source).not.toMatch(/console\.log\([^)]*homepageHtml/);
    expect(source).not.toMatch(/console\.log\([^)]*menuText/);
  });

  it("pins PDF menu extraction to Gemini (never hands a PDF to OpenAI)", () => {
    expect(source).toMatch(/menuPdfConfigGeminiOnly/);
    expect(source).toMatch(/fallbackEnabled:\s*false/);
    expect(source).toMatch(/mimeType:\s*"application\/pdf"/);
  });
});
