import { afterEach, describe, expect, it, vi } from "vitest";

import {
  aiDealDraftStorageKey,
  buildAiDealRecoveryDraft,
  parseAiDealRecoveryDraft,
} from "./ai-deal-draft-recovery";
import { createDefaultDealEligibilityFormState } from "./deal-eligibility-form";

const eligibilityForm = createDefaultDealEligibilityFormState();

describe("AI deal draft recovery", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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
        merchantOriginalWarningAcknowledged: false,
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
      merchantOriginalWarningAcknowledged: true,
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
    expect(parsed?.merchantOriginalWarningAcknowledged).toBe(true);
    expect(parsed?.generatedAd?.poster_storage_path).toBe("biz-1/generated.jpg");
    expect(parsed?.daysOfWeek).toEqual([1, 5]);
    expect(parsed?.adAccepted).toBe(true);
    expect(parsed?.creativeFormat).toBe("poster_v1");
    expect(parsed?.previewFormat).toBe("poster_v1");
  });

  it("round-trips edited poster text and treats it as recoverable on its own", () => {
    const draft = buildAiDealRecoveryDraft({
      businessId: "biz-1",
      photoPath: null,
      posterUrl: null,
      photoTreatment: "studiopolish",
      customImageEditInstruction: "",
      usePhotoAsFinal: false,
      merchantOriginalWarningAcknowledged: false,
      hintText: "",
      price: "",
      title: "",
      promoLine: "",
      posterHeadlineText: "AFTERNOON PICK ME UP",
      posterSublineText: "BAKED FRESH DAILY",
      ctaText: "",
      description: "",
      eligibilityForm,
      maxClaims: "50",
      cutoffMins: "15",
      validityMode: "one-time",
      startTime: "2026-06-16T15:00:00.000Z",
      endTime: "2026-06-16T17:00:00.000Z",
      daysOfWeek: [1, 2, 3, 4, 5],
      windowStartMinutes: 540,
      windowEndMinutes: 1020,
      timezone: "America/Chicago",
      publishLocationIds: [],
      generatedAd: null,
      adAccepted: false,
      manualDraftUnlocked: false,
    });

    expect(draft).not.toBeNull();
    const parsed = parseAiDealRecoveryDraft(JSON.stringify(draft), "biz-1");
    expect(parsed?.posterHeadlineText).toBe("AFTERNOON PICK ME UP");
    expect(parsed?.posterSublineText).toBe("BAKED FRESH DAILY");
  });

  it("defaults missing poster text fields on older stored drafts", () => {
    const draft = buildAiDealRecoveryDraft({
      businessId: "biz-1",
      photoPath: "biz-1/reference.jpg",
      posterUrl: null,
      photoTreatment: "studiopolish",
      customImageEditInstruction: "",
      usePhotoAsFinal: false,
      merchantOriginalWarningAcknowledged: false,
      hintText: "BOGO latte",
      price: "",
      title: "",
      promoLine: "",
      ctaText: "",
      description: "",
      eligibilityForm,
      maxClaims: "50",
      cutoffMins: "15",
      validityMode: "one-time",
      startTime: "2026-06-16T15:00:00.000Z",
      endTime: "2026-06-16T17:00:00.000Z",
      daysOfWeek: [1, 2, 3, 4, 5],
      windowStartMinutes: 540,
      windowEndMinutes: 1020,
      timezone: "America/Chicago",
      publishLocationIds: [],
      generatedAd: null,
      adAccepted: false,
      manualDraftUnlocked: false,
    });
    expect(draft).not.toBeNull();
    const legacy = { ...draft } as Record<string, unknown>;
    delete legacy.posterHeadlineText;
    delete legacy.posterSublineText;

    const parsed = parseAiDealRecoveryDraft(JSON.stringify(legacy), "biz-1");
    expect(parsed?.posterHeadlineText).toBe("");
    expect(parsed?.posterSublineText).toBe("");
  });

  it("preserves an explicit standard-card draft choice", () => {
    const draft = buildAiDealRecoveryDraft({
      businessId: "biz-1",
      photoPath: "biz-1/reference.jpg",
      posterUrl: null,
      photoTreatment: "studiopolish",
      customImageEditInstruction: "",
      usePhotoAsFinal: false,
      merchantOriginalWarningAcknowledged: false,
      creativeFormat: "standard_card",
      previewFormat: "standard_card",
      hintText: "BOGO latte",
      price: "",
      title: "BOGO Iced Latte",
      promoLine: "Buy one, get one free",
      ctaText: "Claim deal",
      description: "Today only.",
      eligibilityForm,
      maxClaims: "25",
      cutoffMins: "10",
      validityMode: "one-time",
      startTime: "2026-06-16T15:00:00.000Z",
      endTime: "2026-06-16T17:00:00.000Z",
      daysOfWeek: [],
      windowStartMinutes: 600,
      windowEndMinutes: 900,
      timezone: "America/Chicago",
      publishLocationIds: [],
      generatedAd: null,
      adAccepted: false,
      manualDraftUnlocked: false,
    });

    const parsed = parseAiDealRecoveryDraft(JSON.stringify(draft), "biz-1");

    expect(parsed?.creativeFormat).toBe("standard_card");
    expect(parsed?.previewFormat).toBe("standard_card");
  });

  it("recovers older poster drafts as poster format when a poster spec is present", () => {
    const raw = JSON.stringify({
      version: 1,
      businessId: "biz-1",
      title: "Buy coffee and get a cookie",
      eligibilityForm,
      maxClaims: "50",
      cutoffMins: "15",
      validityMode: "one-time",
      startTime: "2026-06-16T15:00:00.000Z",
      endTime: "2026-06-16T17:00:00.000Z",
      generatedAd: {
        headline: "Buy coffee and get a cookie",
        poster_storage_path: "biz-1/generated.jpg",
        poster: {
          enabled: true,
        },
      },
      adAccepted: true,
    });

    const parsed = parseAiDealRecoveryDraft(raw, "biz-1");

    expect(parsed?.creativeFormat).toBe("poster_v1");
    expect(parsed?.previewFormat).toBe("poster_v1");
  });

  it("defaults missing draft schedule to five minutes from now with a one-hour duration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T17:20:00.000Z"));
    const raw = JSON.stringify({
      version: 1,
      businessId: "biz-1",
      title: "Buy coffee and get a cookie",
      eligibilityForm,
    });

    const parsed = parseAiDealRecoveryDraft(raw, "biz-1");

    expect(parsed?.startTime).toBe("2026-06-30T17:25:00.000Z");
    expect(parsed?.endTime).toBe("2026-06-30T18:25:00.000Z");
  });

  it("rejects malformed, old, and different-business drafts", () => {
    expect(parseAiDealRecoveryDraft("{", "biz-1")).toBeNull();
    expect(parseAiDealRecoveryDraft(JSON.stringify({ version: 0, businessId: "biz-1" }), "biz-1")).toBeNull();
    expect(parseAiDealRecoveryDraft(JSON.stringify({ version: 1, businessId: "biz-2", title: "Deal" }), "biz-1")).toBeNull();
  });
});
