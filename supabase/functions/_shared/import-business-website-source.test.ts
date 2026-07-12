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

  it("retries an http Places URL as https before rejecting, but only when NOT_HTTPS", () => {
    // The upgraded URL must be re-validated (never fetched on trust).
    expect(source).toMatch(/upgradeHttpToHttps\(websiteUrlRaw\)/);
    expect(source).toMatch(/validated\.code === "NOT_HTTPS"/);
    expect(source).toMatch(/validateImportUrl\(upgraded\)/);
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

  it("routes text menu extraction Gemini-primary, OpenAI-fallback (schema bug fixed)", () => {
    // The Gemini INVALID_ARGUMENT root cause (nested `name` field stripped from
    // the schema) is fixed in gemini-text-provider.ts, so the cheap Gemini path
    // is the primary again with OpenAI as fallback for redundancy.
    const textCfg = source.slice(
      source.indexOf("function menuTextConfig"),
      source.indexOf("function menuPdfConfigGeminiOnly"),
    );
    expect(textCfg).toMatch(/primaryProvider:\s*"gemini"/);
    expect(textCfg).toMatch(/fallbackProvider:\s*"openai"/);
    expect(textCfg).toMatch(/fallbackEnabled:\s*true/);
  });

  it("makes the 20s menu budget real and retries a full-timeout primary", () => {
    // The router uses config timeouts, not the request's timeoutMs — both menu
    // configs must override the 15s/14s env defaults and opt into timeout retry.
    expect(source.match(/primaryTimeoutMs:\s*20_000/g)?.length).toBe(2);
    expect(source.match(/fallbackTimeoutMs:\s*20_000/g)?.length).toBe(2);
    expect(source.match(/retryAfterFullTimeout:\s*true/g)?.length).toBe(2);
  });

  it("clamps the menu prompt text before handing it to the LLM", () => {
    expect(source).toMatch(/clampMenuPromptText\(menuText\)/);
  });

  it("maps circuit-open to MENU_BUSY and never buries it under MENU_NOT_FOUND", () => {
    expect(source).toMatch(/AI_PROVIDER_CIRCUIT_OPEN"\s*\?\s*"MENU_BUSY"\s*:\s*"MENU_EXTRACTION_FAILED"/);
    expect(source).toMatch(/!warnings\.includes\("MENU_BUSY"\)/);
  });
});
