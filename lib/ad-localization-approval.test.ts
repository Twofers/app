import { describe, expect, it } from "vitest";

import { buildDeterministicAdLocalizationBundle } from "./ad-localization";
import {
  AD_LOCALIZATION_APPROVAL_POLICY_VERSION,
  buildVerifiedAdLocalizationApproval,
} from "./ad-localization-approval";
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
  const offerDefinition = definition();
  return buildDeterministicAdLocalizationBundle({
    sourceLocale: "en-US",
    sourceCreative: {
      headline: "Latte run, cookie reward",
      supportingCopy: "Your afternoon coffee comes with a little extra.",
      imageAltText: "Latte and cookie on a cafe counter",
    },
    offerDefinition,
    protectedTerms: ["Cedar Bean", "latte", "cookie"],
  });
}

describe("buildVerifiedAdLocalizationApproval", () => {
  it("approves a complete bundle and binds it to presentation, offer, terms, and row hashes", () => {
    const offerDefinition = definition();
    const localizationBundle = bundle();
    const result = buildVerifiedAdLocalizationApproval({
      bundle: localizationBundle,
      offerDefinition,
      presentationHash: "adp_1111222233334444",
      selectedImageAssetId: "deal-photos/cedar-latte.png",
    });
    const repeat = buildVerifiedAdLocalizationApproval({
      bundle: localizationBundle,
      offerDefinition,
      presentationHash: "adp_1111222233334444",
      selectedImageAssetId: "deal-photos/cedar-latte.png",
    });

    expect(result.approved).toBe(true);
    if (!result.approved || !repeat.approved) throw new Error("expected approval");
    expect(result.approval.policyVersion).toBe(AD_LOCALIZATION_APPROVAL_POLICY_VERSION);
    expect(result.approval.approvalHash).toMatch(/^adlocappr_[0-9a-f]{16}$/);
    expect(result.approval.approvalHash).toBe(repeat.approval.approvalHash);
    expect(result.approval.sourceCreativeHash).toBe(localizationBundle.sourceCreativeHash);
    expect(result.approval.localizationBundleHash).toBe(localizationBundle.localizationBundleHash);
    expect(result.approval.presentationHash).toBe("adp_1111222233334444");
    expect(result.approval.selectedImageAssetId).toBe("deal-photos/cedar-latte.png");
    expect(result.approval.enabledLocales).toEqual(["en-US", "es-US", "ko-KR"]);
    expect(result.approval.localizedTermSnapshotHash).toMatch(/^adterms_[0-9a-f]{16}$/);
    expect(result.approval.localizationRowHashes["es-US"]).toMatch(/^adlocrow_[0-9a-f]{8}$/);
  });

  it("changes the approval hash when the selected presentation changes", () => {
    const offerDefinition = definition();
    const localizationBundle = bundle();
    const first = buildVerifiedAdLocalizationApproval({
      bundle: localizationBundle,
      offerDefinition,
      presentationHash: "adp_1111222233334444",
      selectedImageAssetId: "deal-photos/cedar-latte.png",
    });
    const changed = buildVerifiedAdLocalizationApproval({
      bundle: localizationBundle,
      offerDefinition,
      presentationHash: "adp_aaaabbbbccccdddd",
      selectedImageAssetId: "deal-photos/cedar-latte.png",
    });

    if (!first.approved || !changed.approved) throw new Error("expected approval");
    expect(changed.approval.approvalHash).not.toBe(first.approval.approvalHash);
  });

  it("blocks approval when a supplied localization snapshot does not match the bundle", () => {
    const offerDefinition = definition();
    const localizationBundle = bundle();
    const approved = buildVerifiedAdLocalizationApproval({
      bundle: localizationBundle,
      offerDefinition,
      presentationHash: "adp_1111222233334444",
      selectedImageAssetId: "deal-photos/cedar-latte.png",
    });
    if (!approved.approved) throw new Error("expected approval");

    const result = buildVerifiedAdLocalizationApproval({
      bundle: localizationBundle,
      offerDefinition,
      presentationHash: "adp_1111222233334444",
      selectedImageAssetId: "deal-photos/cedar-latte.png",
      localizationSnapshot: {
        ...approved.localizationSnapshot,
        sourceLocale: "es-US",
        enabledLocales: ["en-US", "es-US"],
        sourceCreativeHash: "adsrc_deadbeef",
        localizationBundleHash: "adloc_deadbeef",
      },
    });

    expect(result.approved).toBe(false);
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining([
        "LOCALIZATION_SNAPSHOT_SOURCE_LOCALE_MISMATCH",
        "LOCALIZATION_SNAPSHOT_ENABLED_LOCALES_MISMATCH",
        "LOCALIZATION_SNAPSHOT_SOURCE_HASH_MISMATCH",
        "LOCALIZATION_SNAPSHOT_BUNDLE_HASH_MISMATCH",
      ]),
    );
  });

  it("blocks approval when a required locale or visual QA requirement is missing", () => {
    const offerDefinition = definition();
    const localizationBundle = bundle();
    const result = buildVerifiedAdLocalizationApproval({
      bundle: {
        ...localizationBundle,
        localizations: {
          ...localizationBundle.localizations,
          "ko-KR": undefined as never,
        },
      },
      offerDefinition,
      presentationHash: "adp_1111222233334444",
      selectedImageAssetId: "deal-photos/cedar-latte.png",
      screenshotQaRequired: true,
    });

    expect(result.approved).toBe(false);
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining(["MISSING_ENABLED_LOCALE", "MISSING_AD_LOCALIZATION_ROW", "SCREENSHOT_QA_REQUIRED"]),
    );
  });

  it("blocks approval when final persuasive localization QA is not passing", () => {
    const offerDefinition = definition();
    const localizationBundle = bundle();
    const result = buildVerifiedAdLocalizationApproval({
      bundle: localizationBundle,
      offerDefinition,
      presentationHash: "adp_1111222233334444",
      selectedImageAssetId: "deal-photos/cedar-latte.png",
      localizationSnapshot: {
        ...buildVerifiedAdLocalizationApproval({
          bundle: localizationBundle,
          offerDefinition,
          presentationHash: "adp_1111222233334444",
          selectedImageAssetId: "deal-photos/cedar-latte.png",
        }).localizationSnapshot!,
        translationQaSummary: {
          ...buildVerifiedAdLocalizationApproval({
            bundle: localizationBundle,
            offerDefinition,
            presentationHash: "adp_1111222233334444",
            selectedImageAssetId: "deal-photos/cedar-latte.png",
          }).localizationSnapshot!.translationQaSummary,
          "es-US": {
            translationStatus: "persuasive_transcreation",
            qaDecision: "repair",
            qaReasonCodes: ["MEANING_CHANGED"],
            repairAttempted: false,
            repairStatus: "not_attempted",
            repairReasonCodes: ["MEANING_CHANGED"],
          },
        },
      },
    });

    expect(result.approved).toBe(false);
    expect(result.reasonCodes).toContain("PERSUASIVE_LOCALE_QA_NOT_PASSING");
  });
});
