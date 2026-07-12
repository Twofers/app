import { describe, expect, it } from "vitest";

import { buildDeterministicAdLocalizationBundle } from "./ad-localization";
import {
  AD_LOCALIZATION_STORAGE_VERSION,
  buildAdLocalizationStorageRows,
  buildOfferVersionLocalizationSnapshot,
} from "./ad-localization-storage";
import { buildDefaultAdPresentationSpec } from "./ad-presentation-spec";
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

function bundle() {
  return buildDeterministicAdLocalizationBundle({
    sourceLocale: "en-US",
    sourceCreative: {
      headline: "Latte run, cookie reward",
      supportingCopy: "Your afternoon coffee comes with a little extra.",
      imageAltText: "Latte and cookie on a cafe counter",
    },
    offerDefinition: definition(),
    protectedTerms: ["Cedar Bean", "latte", "cookie"],
  });
}

describe("ad localization storage snapshot", () => {
  it("builds per-locale storage rows without storing exact offer mechanics", () => {
    const built = bundle();
    const rows = buildAdLocalizationStorageRows({ bundle: built });

    expect(rows["en-US"]).toMatchObject({
      sourceLocale: "en-US",
      headline: "Latte run, cookie reward",
      sourceCopyHash: built.sourceCreativeHash,
      translationStatus: "source_creative",
      qaDecision: "not_required",
    });
    expect(rows["es-US"]?.localizationHash).toMatch(/^adlocrow_[0-9a-f]{8}$/);
    expect(rows["es-US"]?.preservedTerms).toEqual(expect.arrayContaining(["Cedar Bean", "latte"]));
    expect(rows["es-US"]?.preservedTerms).not.toContain("cookie");
    expect(JSON.stringify(rows)).not.toContain("exactOfferLine");
    expect(JSON.stringify(rows)).not.toContain("termsLine");
    expect(JSON.stringify(rows)).not.toContain("Al comprar 1 latte, recibes 1 galleta gratis");
  });

  it("builds an offer-version localization snapshot with term and presentation metadata", () => {
    const presentation = buildDefaultAdPresentationSpec({
      imageAssetId: "deal-photos/cedar-latte.png",
      imageSourceType: "merchant_original",
      localeOverrides: {
        "es-US": {
          templateId: "split_offer_panel",
          textPanel: "solid_bottom",
          showSupportingCopy: false,
          resolutionReasonCodes: ["LONG_SPANISH_COPY_SAFE_SPLIT"],
        },
      },
    });
    const snapshot = buildOfferVersionLocalizationSnapshot({
      bundle: bundle(),
      offerDefinition: definition(),
      localePresentationOverrides: presentation.localeOverrides,
    });

    expect(snapshot?.storageVersion).toBe(AD_LOCALIZATION_STORAGE_VERSION);
    expect(snapshot?.sourceLocale).toBe("en-US");
    expect(snapshot?.enabledLocales).toEqual(["en-US", "es-US", "ko-KR"]);
    expect(snapshot?.deterministicFallbackLocales).toEqual(["es-US", "ko-KR"]);
    expect(snapshot?.localePresentationOverrides?.["es-US"]).toMatchObject({
      templateId: "split_offer_panel",
      showSupportingCopy: false,
    });
    expect(snapshot?.localizedTermSnapshot.locales["en-US"]?.localizedTermSnapshotIds.length).toBeGreaterThan(0);
    expect(snapshot?.translationQaSummary["ko-KR"]?.translationStatus).toBe("deterministic_fallback");
  });
});
