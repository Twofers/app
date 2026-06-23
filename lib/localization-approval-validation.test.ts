import { describe, expect, it } from "vitest";

import { buildDeterministicAdLocalizationBundle } from "./ad-localization";
import { buildVerifiedAdLocalizationApproval } from "./ad-localization-approval";
import { buildOfferDefinitionV1 } from "./offer-definition";
import { validateExactLocalizationApprovalPayload } from "../supabase/functions/_shared/localization-approval-validation";

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

function approvedLocalization() {
  const offerDefinition = definition();
  const bundle = buildDeterministicAdLocalizationBundle({
    sourceLocale: "en-US",
    sourceCreative: {
      headline: "Latte run, cookie reward",
      supportingCopy: "Your afternoon coffee comes with a little extra.",
      imageAltText: "Latte and cookie on a cafe counter",
    },
    offerDefinition,
    protectedTerms: ["Cedar Bean", "latte", "cookie"],
  });
  const approval = buildVerifiedAdLocalizationApproval({
    bundle,
    offerDefinition,
    presentationHash: "adp_1111222233334444",
    selectedImageAssetId: "deal-photos/cedar-latte.png",
  });
  if (!approval.approved) throw new Error(`expected approval: ${approval.reasonCodes.join(",")}`);
  return {
    offerDefinition,
    localization: {
      ...approval.localizationSnapshot,
      approval: approval.approval,
    },
    composedCard: {
      presentationHash: approval.approval.presentationHash,
      presentation: {
        imageAssetId: approval.approval.selectedImageAssetId,
      },
    },
  };
}

describe("exact localization approval validation", () => {
  it("accepts a client-built verified localization approval snapshot", () => {
    const fixture = approvedLocalization();

    expect(validateExactLocalizationApprovalPayload({
      localization: fixture.localization,
      composedCard: fixture.composedCard,
      offerDefinition: fixture.offerDefinition,
      exactRequired: true,
    })).toEqual([]);
  });

  it("requires the approval snapshot only when exact approval is enabled", () => {
    const fixture = approvedLocalization();
    const { approval: _approval, ...withoutApproval } = fixture.localization;

    expect(validateExactLocalizationApprovalPayload({
      localization: withoutApproval,
      composedCard: fixture.composedCard,
      offerDefinition: fixture.offerDefinition,
      exactRequired: false,
    })).toEqual([]);
    expect(validateExactLocalizationApprovalPayload({
      localization: withoutApproval,
      composedCard: fixture.composedCard,
      offerDefinition: fixture.offerDefinition,
      exactRequired: true,
    })).toEqual(["MISSING_LOCALIZATION_APPROVAL"]);
  });

  it("rejects stale approval bindings for presentation, image, bundle, terms, and rows", () => {
    const fixture = approvedLocalization();
    const staleLocalization = {
      ...fixture.localization,
      localizationBundleHash: "adloc_deadbeef",
      localizedTermSnapshot: {
        ...fixture.localization.localizedTermSnapshot,
        rendererVersion: "changed-renderer",
      },
      localizations: {
        ...fixture.localization.localizations,
        "es-US": {
          ...fixture.localization.localizations["es-US"],
          headline: "Changed after approval",
        },
      },
    };

    expect(validateExactLocalizationApprovalPayload({
      localization: staleLocalization,
      composedCard: {
        presentationHash: "adp_aaaabbbbccccdddd",
        presentation: { imageAssetId: "deal-photos/other.png" },
      },
      offerDefinition: fixture.offerDefinition,
      exactRequired: true,
    })).toEqual(
      expect.arrayContaining([
        "LOCALIZATION_APPROVAL_BUNDLE_HASH_MISMATCH",
        "LOCALIZATION_APPROVAL_TERM_HASH_MISMATCH",
        "LOCALIZATION_APPROVAL_PRESENTATION_HASH_MISMATCH",
        "LOCALIZATION_APPROVAL_SELECTED_IMAGE_MISMATCH",
        "STALE_LOCALIZATION_HASH",
      ]),
    );
  });

  it("rejects protected-term failures and non-passing persuasive QA", () => {
    const fixture = approvedLocalization();
    const blockedLocalization = {
      ...fixture.localization,
      translationQaSummary: {
        ...fixture.localization.translationQaSummary,
        "es-US": {
          translationStatus: "persuasive_transcreation",
          qaDecision: "repair",
          qaReasonCodes: ["PROTECTED_TERM_CHANGED"],
          repairAttempted: false,
          repairStatus: "not_attempted",
          repairReasonCodes: ["PROTECTED_TERM_CHANGED"],
        },
      },
    };

    expect(validateExactLocalizationApprovalPayload({
      localization: blockedLocalization,
      composedCard: fixture.composedCard,
      offerDefinition: fixture.offerDefinition,
      exactRequired: true,
    })).toEqual(expect.arrayContaining(["PROTECTED_TERM_CHANGED", "PERSUASIVE_LOCALE_QA_NOT_PASSING"]));
  });
});
