import { describe, expect, it } from "vitest";

import {
  aiDealDraftStorageKey,
  buildAiDealRecoveryDraft,
  parseAiDealRecoveryDraft,
} from "./ai-deal-draft-recovery";
import { createDefaultDealEligibilityFormState } from "./deal-eligibility-form";

const eligibilityForm = createDefaultDealEligibilityFormState();

describe("AI deal draft recovery", () => {
  it("uses a business-scoped storage key", () => {
    expect(aiDealDraftStorageKey(" biz-1 ")).toBe("twofer.aiDealDraft.v1.biz-1");
  });

  it("does not persist an empty compose form", () => {
    expect(
      buildAiDealRecoveryDraft({
        businessId: "biz-1",
        photoPath: null,
        posterUrl: null,
        photoTreatment: "studiopolish",
        customImageEditInstruction: "",
        usePhotoAsFinal: false,
        hintText: "",
        price: "",
        title: "",
        promoLine: "",
        ctaText: "",
        description: "",
        eligibilityForm,
        maxClaims: "50",
        cutoffMins: "15",
        validityMode: "one-time",
        startTime: new Date("2026-06-16T15:00:00.000Z").toISOString(),
        endTime: new Date("2026-06-16T17:00:00.000Z").toISOString(),
        daysOfWeek: [1, 2, 3, 4, 5],
        windowStartMinutes: 540,
        windowEndMinutes: 1020,
        timezone: "America/Chicago",
        publishLocationIds: [],
        generatedAd: null,
        adAccepted: false,
        manualDraftUnlocked: false,
      }),
    ).toBeNull();
  });

  it("round-trips a generated draft with durable image paths", () => {
    const draft = buildAiDealRecoveryDraft({
      businessId: "biz-1",
      photoPath: "biz-1/reference.jpg",
      posterUrl: "https://example.test/poster.jpg",
      photoTreatment: "cleanbg",
      customImageEditInstruction: "  Warm up the lighting   and remove crumbs.  ",
      usePhotoAsFinal: false,
      hintText: "BOGO latte",
      price: "5",
      title: "BOGO Iced Latte",
      promoLine: "Buy one, get one free",
      ctaText: "Claim deal",
      description: "Today only.",
      eligibilityForm,
      maxClaims: "25",
      cutoffMins: "10",
      validityMode: "recurring",
      startTime: "2026-06-16T15:00:00.000Z",
      endTime: "2026-06-16T17:00:00.000Z",
      daysOfWeek: [5, 1, 5],
      windowStartMinutes: 600,
      windowEndMinutes: 900,
      timezone: "America/Chicago",
      publishLocationIds: ["loc-1"],
      generatedAd: {
        headline: "BOGO Iced Latte",
        subheadline: "Cool off with a second latte free.",
        cta: "Claim deal",
        poster_storage_path: "biz-1/generated.jpg",
      },
      adAccepted: true,
      manualDraftUnlocked: true,
    });

    const parsed = parseAiDealRecoveryDraft(JSON.stringify(draft), "biz-1");

    expect(parsed?.title).toBe("Buy one iced latte and get one free");
    expect(parsed?.generatedAd?.headline).toBe("Buy one iced latte and get one free");
    expect(parsed?.photoPath).toBe("biz-1/reference.jpg");
    expect(parsed?.customImageEditInstruction).toBe("Warm up the lighting and remove crumbs.");
    expect(parsed?.generatedAd?.poster_storage_path).toBe("biz-1/generated.jpg");
    expect(parsed?.daysOfWeek).toEqual([1, 5]);
    expect(parsed?.adAccepted).toBe(true);
  });

  it("rejects malformed, old, and different-business drafts", () => {
    expect(parseAiDealRecoveryDraft("{", "biz-1")).toBeNull();
    expect(parseAiDealRecoveryDraft(JSON.stringify({ version: 0, businessId: "biz-1" }), "biz-1")).toBeNull();
    expect(parseAiDealRecoveryDraft(JSON.stringify({ version: 1, businessId: "biz-2", title: "Deal" }), "biz-1")).toBeNull();
  });
});
