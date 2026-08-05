import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  localizationGlossaryAsPromptTerms,
  localizationGlossaryTerm,
  LOCALIZATION_GLOSSARY_TERMS,
} from "./localization-glossary";

const esLocale = JSON.parse(
  readFileSync(join(process.cwd(), "lib", "i18n", "locales", "es.json"), "utf8"),
);
const koLocale = JSON.parse(
  readFileSync(join(process.cwd(), "lib", "i18n", "locales", "ko.json"), "utf8"),
);

describe("LOCALIZATION_GLOSSARY_TERMS", () => {
  it("covers exactly the seven core vocabulary terms", () => {
    const keys = LOCALIZATION_GLOSSARY_TERMS.map((t) => t.en).sort();
    expect(keys).toEqual(
      ["claim", "deal", "free", "redeem", "second item", "today only", "wallet"].sort(),
    );
  });

  it("every entry has non-empty es and ko renderings", () => {
    for (const entry of LOCALIZATION_GLOSSARY_TERMS) {
      expect(entry.es.trim().length).toBeGreaterThan(0);
      expect(entry.ko.trim().length).toBeGreaterThan(0);
    }
  });

  it("matches the app's own tabs vocabulary in es.json/ko.json (wallet, redeem)", () => {
    const wallet = localizationGlossaryTerm("wallet")!;
    expect(wallet.es).toBe(esLocale.tabs.wallet.toLowerCase());
    expect(wallet.ko).toBe(koLocale.tabs.wallet);

    const redeem = localizationGlossaryTerm("redeem")!;
    expect(redeem.es).toBe(esLocale.tabs.redeem.toLowerCase());
    expect(redeem.ko).toBe(koLocale.tabs.redeem);
  });

  it("matches the app's own deal-detail vocabulary in es.json/ko.json (claim, deal)", () => {
    const claim = localizationGlossaryTerm("claim")!;
    expect(claim.es).toBe(esLocale.dealDetail.claim.toLowerCase());
    expect(claim.ko).toBe(koLocale.dealDetail.claim);

    const deal = localizationGlossaryTerm("deal")!;
    expect(deal.es).toBe(esLocale.dealDetail.dealFallback.toLowerCase());
    expect(deal.ko).toBe(koLocale.dealDetail.dealFallback);
  });

  it("matches the app's own createAi/dealQuality copy for second item and today only", () => {
    const secondItem = localizationGlossaryTerm("second item")!;
    expect(esLocale.dealQuality.strongGuard.second_item_discount.toLowerCase()).toContain(secondItem.es);
    expect(koLocale.dealQuality.strongGuard.second_item_discount).toContain(secondItem.ko);

    const todayOnly = localizationGlossaryTerm("today only")!;
    expect(esLocale.createAi.hintPlaceholder.toLowerCase()).toContain(todayOnly.es);
    expect(koLocale.createAi.hintPlaceholder).toContain(todayOnly.ko);
  });

  it("matches the deterministic renderer's own free-item vocabulary", () => {
    // lib/localized-offer-renderer.ts renderSpanishLine/renderKoreanLine
    // literally print " gratis" / " 무료" for a free reward — this is a
    // regression guard, not a re-derivation, so it stays a plain string
    // check rather than importing the renderer.
    const free = localizationGlossaryTerm("free")!;
    expect(free.es).toBe("gratis");
    expect(free.ko).toBe("무료");
  });

  it("localizationGlossaryTerm is case-insensitive and returns null for unknown terms", () => {
    expect(localizationGlossaryTerm("WALLET")?.es).toBe("billetera");
    expect(localizationGlossaryTerm("Deal")?.ko).toBe("딜");
    expect(localizationGlossaryTerm("nonexistent-term")).toBeNull();
  });
});

describe("localizationGlossaryAsPromptTerms", () => {
  it("maps every glossary entry to a {term, es, ko} prompt row", () => {
    const rows = localizationGlossaryAsPromptTerms();
    expect(rows.length).toBe(LOCALIZATION_GLOSSARY_TERMS.length);
    for (const row of rows) {
      expect(row).toHaveProperty("term");
      expect(row).toHaveProperty("es");
      expect(row).toHaveProperty("ko");
    }
    expect(rows.find((r) => r.term === "wallet")).toEqual({ term: "wallet", es: "billetera", ko: "지갑" });
  });
});
