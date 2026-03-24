import { describe, expect, it } from "vitest";
import { resolveDealFlowLanguage } from "./translate-deal-quality";

/**
 * Explicit matrix for Offers & AI language:
 * - null preferred_locale → follow app (i18n) language
 * - en | es | ko preferred → override app for AI + deal-quality banners on create flows
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

  it("4. English app + Korean AI (preferred ko)", () => {
    expect(resolveDealFlowLanguage("ko", "en")).toBe("ko");
  });

  it("5. Korean app + Same as app (null preferred)", () => {
    expect(resolveDealFlowLanguage(null, "ko")).toBe("ko");
  });

  it("6. Spanish app + English AI (preferred en)", () => {
    expect(resolveDealFlowLanguage("en", "es")).toBe("en");
  });

  it("invalid preferred falls back to app", () => {
    expect(resolveDealFlowLanguage("fr", "es")).toBe("es");
  });

  it("invalid app falls back to en", () => {
    expect(resolveDealFlowLanguage(null, "fr")).toBe("en");
  });
});
