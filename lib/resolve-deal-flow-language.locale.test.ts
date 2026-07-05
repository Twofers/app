import { describe, expect, it } from "vitest";
import { resolveDealFlowLanguage } from "./translate-deal-quality";

/**
 * Explicit matrix for Offers & AI language:
 * - Create flows follow the active app (i18n) language.
 * - Stored business preferred_locale must not override the current owner UI language.
 */
describe("resolveDealFlowLanguage", () => {
  it("1. English app + English AI (null preferred)", () => {
    expect(resolveDealFlowLanguage(null, "en")).toBe("en");
  });

  it("2. Spanish app + Spanish AI (null preferred)", () => {
    expect(resolveDealFlowLanguage(null, "es")).toBe("es");
  });

  it("3. Korean app + Korean AI (null preferred)", () => {
    expect(resolveDealFlowLanguage(null, "ko")).toBe("ko");
  });

  it("4. English app + English AI even when preferred is Korean", () => {
    expect(resolveDealFlowLanguage("ko", "en")).toBe("en");
  });

  it("5. Korean app + Same as app (null preferred)", () => {
    expect(resolveDealFlowLanguage(null, "ko")).toBe("ko");
  });

  it("6. Spanish app + Spanish AI even when preferred is English", () => {
    expect(resolveDealFlowLanguage("en", "es")).toBe("es");
  });

  it("invalid preferred falls back to app", () => {
    expect(resolveDealFlowLanguage("fr", "es")).toBe("es");
  });

  it("invalid app falls back to en", () => {
    expect(resolveDealFlowLanguage(null, "fr")).toBe("en");
  });
});
