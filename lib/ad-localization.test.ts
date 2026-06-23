import { describe, expect, it } from "vitest";

import {
  buildDeterministicAdLocalizationBundle,
  buildQaCheckedAdLocalizationBundle,
} from "./ad-localization";
import { buildOfferDefinitionV1 } from "./offer-definition";

function definition() {
  const built = buildOfferDefinitionV1({
    businessId: "biz_123",
    businessName: "Cedar Bean",
    locationId: "loc_123",
    locationName: "Cedar Bean - Irving",
    dealEligibility: {
      dealType: "BUY_ONE_GET_SOMETHING_FREE",
      appliesTo: "SINGLE_ITEM",
      requiredPurchaseQuantity: 1,
      requiredItemDescription: "latte",
      requiredItemRetailValueCents: 600,
      freeItemQuantity: 1,
      freeItemDescription: "cookie",
      freeItemRetailValueCents: 300,
      freeItemDiscountPercent: 100,
    },
    eligibilityResult: {
      eligible: true,
      eligibilityStatus: "VALID",
      customerValuePercent: 50,
    },
    activeWindowHumanReadable: "Today 2:00 PM to 4:00 PM",
    quantityLimit: 20,
    schedule: {
      mode: "one_time",
      summary: "Today 2:00 PM to 4:00 PM",
      startsAt: "2026-06-23T14:00:00-05:00",
      endsAt: "2026-06-23T16:00:00-05:00",
      timeZone: "America/Chicago",
    },
  });
  if (!built) throw new Error("expected offer definition");
  return built;
}

describe("ad localization deterministic fallback bundle", () => {
  it("keeps source creative only in the source locale and target locales deterministic", () => {
    const bundle = buildDeterministicAdLocalizationBundle({
      sourceLocale: "en-US",
      sourceCreative: {
        headline: "Latte run, cookie reward",
        supportingCopy: "Your afternoon coffee comes with a little extra.",
        imageAltText: "Latte and cookie on a cafe counter",
      },
      offerDefinition: definition(),
    });

    expect(bundle.sourceLocale).toBe("en-US");
    expect(bundle.sourceCreativeHash).toMatch(/^adsrc_[0-9a-f]{8}$/);
    expect(bundle.localizationBundleHash).toMatch(/^adloc_[0-9a-f]{8}$/);
    expect(bundle.deterministicFallbackLocales).toEqual(["es-US", "ko-KR"]);
    expect(bundle.localizations["en-US"]).toMatchObject({
      headline: "Latte run, cookie reward",
      supportingCopy: "Your afternoon coffee comes with a little extra.",
      translationStatus: "source_creative",
      qaDecision: "not_required",
    });
    expect(bundle.localizations["es-US"]).toMatchObject({
      headline: "Oferta local",
      supportingCopy: "Al comprar 1 latte, recibes 1 cookie gratis",
      translationStatus: "deterministic_fallback",
      qaDecision: "unavailable",
      qaReasonCodes: ["DETERMINISTIC_TARGET_FALLBACK"],
    });
    expect(bundle.localizations["ko-KR"].headline).toBe("로컬 딜");
    expect(bundle.localizations["ko-KR"].supportingCopy).toContain("latte");
    expect(bundle.localizations["ko-KR"].supportingCopy).toContain("cookie");
  });

  it("uses stable hashes and changes them when source creative changes", () => {
    const base = {
      sourceLocale: "es-US",
      sourceCreative: {
        headline: "Café con premio",
        supportingCopy: "Tu latte viene con una galleta gratis.",
        imageAltText: "Latte y galleta en el mostrador",
      },
      offerDefinition: definition(),
    };
    const first = buildDeterministicAdLocalizationBundle(base);
    const second = buildDeterministicAdLocalizationBundle(base);
    const changed = buildDeterministicAdLocalizationBundle({
      ...base,
      sourceCreative: { ...base.sourceCreative, headline: "Latte con premio" },
    });

    expect(second.sourceCreativeHash).toBe(first.sourceCreativeHash);
    expect(second.localizationBundleHash).toBe(first.localizationBundleHash);
    expect(changed.sourceCreativeHash).not.toBe(first.sourceCreativeHash);
    expect(changed.localizationBundleHash).not.toBe(first.localizationBundleHash);
  });

  it("records protected terms preserved in deterministic output", () => {
    const bundle = buildDeterministicAdLocalizationBundle({
      sourceLocale: "ko-KR",
      sourceCreative: {
        headline: "Cedar Bean 라떼 혜택",
        supportingCopy: "Cedar Bean에서 라떼와 쿠키를 만나보세요.",
        imageAltText: "Cedar Bean latte and cookie",
      },
      offerDefinition: definition(),
      protectedTerms: ["Cedar Bean", "latte", "cookie"],
    });

    expect(bundle.localizations["en-US"].preservedTerms).toEqual(
      expect.arrayContaining(["Cedar Bean", "latte", "cookie"]),
    );
    expect(bundle.localizations["es-US"].preservedTerms).toEqual(
      expect.arrayContaining(["Cedar Bean", "latte", "cookie"]),
    );
    expect(bundle.localizations["ko-KR"].translationStatus).toBe("source_creative");
  });

  it("uses passing transcreation copy and falls back only failed target locales", () => {
    const bundle = buildQaCheckedAdLocalizationBundle({
      sourceLocale: "en-US",
      sourceCreative: {
        headline: "Cedar Bean latte reward",
        supportingCopy: "Your afternoon latte comes with a cookie.",
        imageAltText: "Cedar Bean latte and cookie",
      },
      targetCreatives: {
        "es-US": {
          headline: "Cedar Bean: latte con cookie gratis",
          supportingCopy: "Tu latte de la tarde viene con una cookie.",
          imageAltText: "Latte y cookie en Cedar Bean",
        },
        "ko-KR": {
          headline: "Cedar Bean latte reward",
          supportingCopy: "Your afternoon latte comes with a cookie.",
          imageAltText: "Cedar Bean latte and cookie",
        },
      },
      offerDefinition: definition(),
      protectedTerms: ["Cedar Bean", "latte", "cookie"],
    });

    expect(bundle.localizations["es-US"]).toMatchObject({
      headline: "Cedar Bean: latte con cookie gratis",
      translationStatus: "persuasive_transcreation",
      qaDecision: "pass",
      qaReasonCodes: [],
    });
    expect(bundle.localizations["ko-KR"]).toMatchObject({
      translationStatus: "deterministic_fallback",
      qaDecision: "repair",
    });
    expect(bundle.localizations["ko-KR"].qaReasonCodes).toEqual(
      expect.arrayContaining(["DETERMINISTIC_TARGET_FALLBACK", "WRONG_LANGUAGE"]),
    );
    expect(bundle.deterministicFallbackLocales).toEqual(["ko-KR"]);
  });

  it("uses a repaired target creative after one repairable QA failure", () => {
    const bundle = buildQaCheckedAdLocalizationBundle({
      sourceLocale: "es-US",
      sourceCreative: {
        headline: "Cedar Bean latte con cookie gratis",
        supportingCopy: "Tu latte de la tarde viene con una cookie.",
        imageAltText: "Latte y cookie en Cedar Bean",
      },
      targetCreatives: {
        "en-US": {
          headline: "Cedar Bean 2x1 latte reward",
          supportingCopy: "Your afternoon latte comes with a cookie.",
          imageAltText: "Cedar Bean latte and cookie",
        },
      },
      repairedTargetCreatives: {
        "en-US": {
          headline: "Cedar Bean latte reward",
          supportingCopy: "Your afternoon latte comes with a cookie.",
          imageAltText: "Cedar Bean latte and cookie",
        },
      },
      offerDefinition: definition(),
      protectedTerms: ["Cedar Bean", "latte", "cookie"],
    });

    expect(bundle.localizations["en-US"]).toMatchObject({
      headline: "Cedar Bean latte reward",
      translationStatus: "persuasive_transcreation",
      qaDecision: "pass",
      qaReasonCodes: [],
      repairAttempted: true,
      repairStatus: "attempted_pass",
      repairReasonCodes: ["BANNED_SHORTHAND"],
    });
    expect(bundle.deterministicFallbackLocales).toEqual(["ko-KR"]);
  });

  it("uses external semantic QA results when accepting target transcreations", () => {
    const bundle = buildQaCheckedAdLocalizationBundle({
      sourceLocale: "en-US",
      sourceCreative: {
        headline: "Cedar Bean latte reward",
        supportingCopy: "Your afternoon latte comes with a cookie.",
        imageAltText: "Cedar Bean latte and cookie",
      },
      targetCreatives: {
        "es-US": {
          headline: "Cedar Bean: latte con cookie gratis",
          supportingCopy: "Tu latte de la tarde viene con una cookie.",
          imageAltText: "Latte y cookie en Cedar Bean",
        },
      },
      targetQaResults: {
        "es-US": {
          locale: "es-US",
          decision: "block",
          hardFailReasons: ["MEANING_CHANGED"],
          scores: {
            semanticParity: 0.2,
            naturalness: 0.8,
            merchantTone: 0.7,
            clarity: 0.8,
            mobileReadability: 0.8,
          },
          conciseFeedback: ["The target headline changes the source idea."],
        },
      },
      offerDefinition: definition(),
      protectedTerms: ["Cedar Bean", "latte", "cookie"],
    });

    expect(bundle.localizations["es-US"]).toMatchObject({
      headline: "Oferta local",
      translationStatus: "deterministic_fallback",
      qaDecision: "block",
      repairStatus: "skipped_non_repairable",
    });
    expect(bundle.localizations["es-US"].qaReasonCodes).toEqual(
      expect.arrayContaining([
        "DETERMINISTIC_TARGET_FALLBACK",
        "TRANSLATION_REPAIR_SKIPPED_NON_REPAIRABLE",
        "MEANING_CHANGED",
      ]),
    );
  });

  it("does not replace a passing target locale with a repair candidate", () => {
    const bundle = buildQaCheckedAdLocalizationBundle({
      sourceLocale: "es-US",
      sourceCreative: {
        headline: "Cedar Bean latte con cookie gratis",
        supportingCopy: "Tu latte de la tarde viene con una cookie.",
        imageAltText: "Latte y cookie en Cedar Bean",
      },
      targetCreatives: {
        "en-US": {
          headline: "Cedar Bean latte reward",
          supportingCopy: "Your afternoon latte comes with a cookie.",
          imageAltText: "Cedar Bean latte and cookie",
        },
      },
      repairedTargetCreatives: {
        "en-US": {
          headline: "Ignored repair headline",
          supportingCopy: "Ignored repair supporting copy.",
          imageAltText: "Ignored repair alt text",
        },
      },
      offerDefinition: definition(),
      protectedTerms: ["Cedar Bean", "latte", "cookie"],
    });

    expect(bundle.localizations["en-US"]).toMatchObject({
      headline: "Cedar Bean latte reward",
      translationStatus: "persuasive_transcreation",
      repairAttempted: false,
      repairStatus: "not_needed",
      repairReasonCodes: [],
    });
    expect(bundle.localizations["en-US"].headline).not.toBe("Ignored repair headline");
  });

  it("falls back when a targeted repair attempt still fails QA", () => {
    const bundle = buildQaCheckedAdLocalizationBundle({
      sourceLocale: "es-US",
      sourceCreative: {
        headline: "Cedar Bean latte con cookie gratis",
        supportingCopy: "Tu latte de la tarde viene con una cookie.",
        imageAltText: "Latte y cookie en Cedar Bean",
      },
      targetCreatives: {
        "en-US": {
          headline: "Cedar Bean 2x1 latte reward",
          supportingCopy: "Your afternoon latte comes with a cookie.",
          imageAltText: "Cedar Bean latte and cookie",
        },
      },
      repairedTargetCreatives: {
        "en-US": {
          headline: "Guaranteed Cedar Bean latte reward",
          supportingCopy: "Your afternoon latte comes with a guaranteed cookie.",
          imageAltText: "Cedar Bean latte and cookie",
        },
      },
      offerDefinition: definition(),
      protectedTerms: ["Cedar Bean", "latte", "cookie"],
    });

    expect(bundle.localizations["en-US"]).toMatchObject({
      headline: "Local deal",
      translationStatus: "deterministic_fallback",
      qaDecision: "repair",
      repairAttempted: true,
      repairStatus: "attempted_failed",
    });
    expect(bundle.localizations["en-US"].qaReasonCodes).toEqual(
      expect.arrayContaining([
        "DETERMINISTIC_TARGET_FALLBACK",
        "TRANSLATION_REPAIR_FAILED",
        "BANNED_SHORTHAND",
        "UNSUPPORTED_CLAIM",
      ]),
    );
    expect(bundle.deterministicFallbackLocales).toEqual(["en-US", "ko-KR"]);
  });

  it("ignores repaired copy for a non-repairable blocked target creative", () => {
    const bundle = buildQaCheckedAdLocalizationBundle({
      sourceLocale: "es-US",
      sourceCreative: {
        headline: "Cedar Bean latte con cookie gratis",
        supportingCopy: "Tu latte de la tarde viene con una cookie.",
        imageAltText: "Latte y cookie en Cedar Bean",
      },
      targetCreatives: {
        "en-US": {
          headline: "Guaranteed Cedar Bean latte reward",
          supportingCopy: "Your afternoon latte comes with a guaranteed cookie.",
          imageAltText: "Cedar Bean latte and cookie",
        },
      },
      repairedTargetCreatives: {
        "en-US": {
          headline: "Cedar Bean latte reward",
          supportingCopy: "Your afternoon latte comes with a cookie.",
          imageAltText: "Cedar Bean latte and cookie",
        },
      },
      offerDefinition: definition(),
      protectedTerms: ["Cedar Bean", "latte", "cookie"],
    });

    expect(bundle.localizations["en-US"]).toMatchObject({
      headline: "Local deal",
      translationStatus: "deterministic_fallback",
      qaDecision: "block",
      repairAttempted: false,
      repairStatus: "skipped_non_repairable",
    });
    expect(bundle.localizations["en-US"].qaReasonCodes).toEqual(
      expect.arrayContaining([
        "DETERMINISTIC_TARGET_FALLBACK",
        "TRANSLATION_REPAIR_SKIPPED_NON_REPAIRABLE",
        "UNSUPPORTED_CLAIM",
      ]),
    );
  });
});
