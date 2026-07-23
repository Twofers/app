import { afterEach, describe, expect, it, vi } from "vitest";

import {
  aiDealDraftStorageKey,
  buildAiDealRecoveryDraft,
  parseAiDealRecoveryDraft,
  resolveRecoveredDealSchedule,
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
    expect(parsed?.adAccepted).toBe(true);
    expect(parsed?.manualDraftUnlocked).toBe(true);
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

  it("rebuilds an end time that does not follow its start time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T04:33:00.000Z"));
    // Observed on an S10: a recovered draft opened with its start refreshed to
    // 11:33 PM but its end still on the previous session's 10:56 PM, so the
    // poster rendered a "REDEEM BY" time already in the past.
    const raw = JSON.stringify({
      version: 1,
      businessId: "biz-1",
      title: "Buy one latte get one latte free",
      eligibilityForm,
      startTime: "2026-07-22T04:33:00.000Z",
      endTime: "2026-07-22T03:56:00.000Z",
    });

    const parsed = parseAiDealRecoveryDraft(raw, "biz-1");

    expect(parsed?.startTime).toBe("2026-07-22T04:33:00.000Z");
    // Rebuilt from the start (+1h), not restored from the stale value.
    expect(parsed?.endTime).toBe("2026-07-22T05:33:00.000Z");
    expect(new Date(parsed!.endTime).getTime()).toBeGreaterThan(new Date(parsed!.startTime).getTime());
  });

  it("keeps an end time equal to the start from surviving recovery", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T04:33:00.000Z"));
    const draft = buildAiDealRecoveryDraft({
      businessId: "biz-1",
      title: "Buy one latte get one latte free",
      eligibilityForm,
      startTime: "2026-07-22T04:33:00.000Z",
      endTime: "2026-07-22T04:33:00.000Z",
    } as Parameters<typeof buildAiDealRecoveryDraft>[0]);

    // A zero-length window is just as unpublishable as an inverted one.
    expect(draft?.endTime).toBe("2026-07-22T05:33:00.000Z");
  });

  it("preserves a valid restored end time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T04:33:00.000Z"));
    const raw = JSON.stringify({
      version: 1,
      businessId: "biz-1",
      title: "Buy one latte get one latte free",
      eligibilityForm,
      startTime: "2026-07-22T04:33:00.000Z",
      endTime: "2026-07-22T06:00:00.000Z",
    });

    const parsed = parseAiDealRecoveryDraft(raw, "biz-1");

    expect(parsed?.endTime).toBe("2026-07-22T06:00:00.000Z");
  });

  it("keeps an end following the start after the apply-time clamp", () => {
    // The S10 case the draft-level repair could not reach: the window was
    // coherent when it was saved (05:00 → 06:00), so nothing was rebuilt at
    // parse time. Advancing the stale start to "now" is what inverts it.
    const raw = JSON.stringify({
      version: 1,
      businessId: "biz-1",
      title: "Buy one latte get one latte free",
      eligibilityForm,
      startTime: "2026-07-22T05:00:00.000Z",
      endTime: "2026-07-22T06:00:00.000Z",
    });

    const parsed = parseAiDealRecoveryDraft(raw, "biz-1");
    // Valid at save time, so parse restores it untouched.
    expect(parsed?.startTime).toBe("2026-07-22T05:00:00.000Z");
    expect(parsed?.endTime).toBe("2026-07-22T06:00:00.000Z");

    const schedule = resolveRecoveredDealSchedule(parsed!, new Date("2026-07-22T14:28:00.000Z"));

    expect(schedule.startTime.toISOString()).toBe("2026-07-22T14:28:00.000Z");
    // Rebuilt from the clamped start (+1h) instead of reopening at 06:00.
    expect(schedule.endTime.toISOString()).toBe("2026-07-22T15:28:00.000Z");
    expect(schedule.endTime.getTime()).toBeGreaterThan(schedule.startTime.getTime());
  });

  it("keeps an end the start clamp does not overtake", () => {
    const schedule = resolveRecoveredDealSchedule(
      {
        startTime: "2026-07-22T05:00:00.000Z",
        endTime: "2026-07-22T18:00:00.000Z",
        validityMode: "one-time",
      },
      new Date("2026-07-22T14:28:00.000Z"),
    );

    expect(schedule.startTime.toISOString()).toBe("2026-07-22T14:28:00.000Z");
    expect(schedule.endTime.toISOString()).toBe("2026-07-22T18:00:00.000Z");
  });

  it("leaves a still-future window untouched", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T14:28:00.000Z"));

    const schedule = resolveRecoveredDealSchedule({
      startTime: "2026-07-22T20:00:00.000Z",
      endTime: "2026-07-22T21:00:00.000Z",
      validityMode: "one-time",
    });

    expect(schedule.startTime.toISOString()).toBe("2026-07-22T20:00:00.000Z");
    expect(schedule.endTime.toISOString()).toBe("2026-07-22T21:00:00.000Z");
  });

  it("does not clamp a recurring draft, whose window is derived at publish", () => {
    const schedule = resolveRecoveredDealSchedule(
      {
        startTime: "2026-07-22T05:00:00.000Z",
        endTime: "2026-07-22T06:00:00.000Z",
        validityMode: "recurring",
      },
      new Date("2026-07-22T14:28:00.000Z"),
    );

    expect(schedule.startTime.toISOString()).toBe("2026-07-22T05:00:00.000Z");
    expect(schedule.endTime.toISOString()).toBe("2026-07-22T06:00:00.000Z");
  });

  it("still repairs a window that was already inverted when saved", () => {
    const schedule = resolveRecoveredDealSchedule(
      {
        startTime: "2026-07-22T20:00:00.000Z",
        endTime: "2026-07-22T19:00:00.000Z",
        validityMode: "one-time",
      },
      new Date("2026-07-22T14:28:00.000Z"),
    );

    // The start is still in the future, so it is not clamped, but the end must
    // be rebuilt from it rather than reopening behind it.
    expect(schedule.startTime.toISOString()).toBe("2026-07-22T20:00:00.000Z");
    expect(schedule.endTime.toISOString()).toBe("2026-07-22T21:00:00.000Z");
  });

  it("rejects malformed, old, and different-business drafts", () => {
    expect(parseAiDealRecoveryDraft("{", "biz-1")).toBeNull();
    expect(parseAiDealRecoveryDraft(JSON.stringify({ version: 0, businessId: "biz-1" }), "biz-1")).toBeNull();
    expect(parseAiDealRecoveryDraft(JSON.stringify({ version: 1, businessId: "biz-2", title: "Deal" }), "biz-1")).toBeNull();
  });
});
