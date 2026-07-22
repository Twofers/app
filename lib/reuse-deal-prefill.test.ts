import { describe, expect, it } from "vitest";

import { buildReuseDealPrefillParams } from "./reuse-deal-prefill";

describe("reuse deal prefill params", () => {
  it("copies publishable content, schedule metadata, and stored poster path", () => {
    const params = buildReuseDealPrefillParams({
      title: "  BOGO latte  ",
      description: " Buy one iced latte, get one free. ",
      source_locale: "en",
      price: 5,
      poster_storage_path: " biz-1/latte.jpg ",
      is_recurring: true,
      days_of_week: [1, 5],
      window_start_minutes: 540,
      window_end_minutes: 660,
      timezone: "America/Chicago",
      max_claims: 25,
      claim_cutoff_buffer_minutes: 10,
    });

    expect(params).toEqual({
      fromReuse: "1",
      prefillTitle: "Buy one latte and get one free",
      prefillHint: "Buy one iced latte, get one free.",
      prefillDescription: "Buy one iced latte, get one free.",
      prefillCta: "Claim deal",
      prefillPrice: "5",
      prefillSourceLocale: "en",
      prefillDealEligibility: params.prefillDealEligibility,
      prefillPosterPath: "biz-1/latte.jpg",
      prefillIsRecurring: "1",
      prefillDaysOfWeek: "1,5",
      prefillWindowStartMin: "540",
      prefillWindowEndMin: "660",
      prefillTimezone: "America/Chicago",
      prefillMaxClaims: "25",
      prefillCutoffMins: "10",
    });
    expect(JSON.parse(params.prefillDealEligibility ?? "{}")).toMatchObject({
      dealType: "BUY_ONE_GET_ONE_FREE",
      requiredItemDescription: "Buy one latte and get one free",
      requiredItemRetailValue: "5",
      freeItemDescription: "Buy one latte and get one free",
      freeItemRetailValue: "5",
    });
  });

  it("can reset one-time schedule metadata for duplicated deal drafts while preserving duration", () => {
    const params = buildReuseDealPrefillParams(
      {
        title: "BOGO latte",
        description: "Buy one iced latte, get one free.",
        price: 5,
        poster_storage_path: "biz-1/latte.jpg",
        start_time: "2026-06-30T20:00:00.000Z",
        end_time: "2026-06-30T22:30:00.000Z",
        is_recurring: false,
        max_claims: 25,
        claim_cutoff_buffer_minutes: 10,
      },
      { resetSchedule: true, now: new Date("2026-07-01T17:00:00.000Z") },
    );

    expect(params).toMatchObject({
      fromReuse: "1",
      prefillTitle: "Buy one latte and get one free",
      prefillPosterPath: "biz-1/latte.jpg",
      prefillIsRecurring: "0",
      prefillStartTime: "2026-07-01T17:05:00.000Z",
      prefillEndTime: "2026-07-01T19:35:00.000Z",
      prefillMaxClaims: "25",
      prefillCutoffMins: "10",
    });
    expect(params).not.toHaveProperty("prefillDaysOfWeek");
    expect(params).not.toHaveProperty("prefillWindowStartMin");
    expect(params).not.toHaveProperty("prefillWindowEndMin");
    expect(params).not.toHaveProperty("prefillTimezone");
  });

  it("keeps the stored deal type when the optional item values are blank", () => {
    // Observed on an S10 on 2026-07-22: reusing a BOGO deal opened the create
    // screen on "40%+ off item" with an empty item and "Not eligible yet".
    // hasCompleteEligibility wants the item retail values and inference wants a
    // price, but the create form labels all three "(optional)", so an ordinary
    // BOGO fell through both and no eligibility param was emitted at all.
    const params = buildReuseDealPrefillParams(
      {
        title: "Buy one latte and get one free",
        description: "Purchase one latte to receive one latte free.",
        deal_type: "BUY_ONE_GET_ONE_FREE",
        required_item_description: "latte",
        required_item_retail_value_cents: null,
        free_item_description: "latte",
        free_item_retail_value_cents: null,
        price: null,
        is_recurring: false,
      },
      { resetSchedule: true, now: new Date("2026-07-22T19:00:00.000Z") },
    );

    const eligibility = JSON.parse(params.prefillDealEligibility) as { dealType: string; requiredItemDescription: string };
    expect(eligibility.dealType).toBe("BUY_ONE_GET_ONE_FREE");
    expect(eligibility.requiredItemDescription).toBe("latte");
  });

  it("lets inference fill blanks without overriding the stored deal type", () => {
    const params = buildReuseDealPrefillParams(
      {
        title: "Buy one latte and get one free",
        description: "Purchase one latte to receive one latte free.",
        deal_type: "BUY_ONE_GET_ONE_FREE",
        required_item_description: "",
        price: 6,
        is_recurring: false,
      },
      { resetSchedule: true, now: new Date("2026-07-22T19:00:00.000Z") },
    );

    const eligibility = JSON.parse(params.prefillDealEligibility) as {
      dealType: string;
      requiredItemDescription: string;
      requiredItemRetailValue: string;
    };
    expect(eligibility.dealType).toBe("BUY_ONE_GET_ONE_FREE");
    // Blank stored fields fall back to the inferred ones rather than staying empty.
    expect(eligibility.requiredItemDescription).toBe("Buy one latte and get one free");
    expect(eligibility.requiredItemRetailValue).toBe("6");
  });

  it("still infers when the row carries no usable deal type", () => {
    const params = buildReuseDealPrefillParams(
      {
        title: "Buy one latte and get one free",
        description: "Purchase one latte to receive one latte free.",
        price: 6,
        is_recurring: false,
      },
      { resetSchedule: true, now: new Date("2026-07-22T19:00:00.000Z") },
    );

    expect(JSON.parse(params.prefillDealEligibility).dealType).toBe("BUY_ONE_GET_ONE_FREE");
  });

  it("grows a duplicated window that is shorter than its own claim cutoff", () => {
    // Observed on an S10 on 2026-07-22. The source deal was ended early, so it
    // recorded a 2-minute run (9:43–9:45) while still carrying the merchant's
    // 15-minute cutoff. Copying both verbatim produced a draft the create screen
    // refuses to publish, reported only as a generic "fix the deal details".
    const params = buildReuseDealPrefillParams(
      {
        title: "BOGO latte",
        start_time: "2026-07-22T14:43:00.000Z",
        end_time: "2026-07-22T14:45:00.000Z",
        is_recurring: false,
        claim_cutoff_buffer_minutes: 15,
      },
      { resetSchedule: true, now: new Date("2026-07-22T17:00:00.000Z") },
    );

    // Window grown to 16 minutes so it outlasts the 15-minute cutoff, which is
    // kept because it is a deliberate setting while the 2 minutes is an artifact.
    expect(params.prefillStartTime).toBe("2026-07-22T17:05:00.000Z");
    expect(params.prefillEndTime).toBe("2026-07-22T17:21:00.000Z");
    expect(params.prefillCutoffMins).toBe("15");

    const durationMinutes =
      (new Date(params.prefillEndTime).getTime() - new Date(params.prefillStartTime).getTime()) / 60000;
    expect(Number(params.prefillCutoffMins)).toBeLessThan(durationMinutes);
  });

  it("clamps a duplicated cutoff that no window length could outlast", () => {
    // A cutoff at or beyond the 4-hour cap cannot be fixed by growing the window,
    // so the cutoff itself has to give.
    const params = buildReuseDealPrefillParams(
      {
        title: "BOGO latte",
        start_time: "2026-07-22T14:00:00.000Z",
        end_time: "2026-07-22T15:00:00.000Z",
        is_recurring: false,
        claim_cutoff_buffer_minutes: 600,
      },
      { resetSchedule: true, now: new Date("2026-07-22T17:00:00.000Z") },
    );

    // Window capped at 4 hours, cutoff pulled just under it.
    expect(params.prefillEndTime).toBe("2026-07-22T21:05:00.000Z");
    expect(params.prefillCutoffMins).toBe("239");
  });

  it("shortens a duplicated cutoff that outlasts a recurring daily window", () => {
    // A recurring window's length is the merchant's own start/end minutes, so it
    // is not grown; the cutoff is shortened to fit instead.
    const params = buildReuseDealPrefillParams(
      {
        title: "BOGO latte",
        is_recurring: true,
        days_of_week: [1, 2],
        window_start_minutes: 540,
        window_end_minutes: 570,
        claim_cutoff_buffer_minutes: 45,
      },
      { resetSchedule: true, now: new Date("2026-07-22T17:00:00.000Z") },
    );

    expect(params.prefillWindowStartMin).toBe("540");
    expect(params.prefillWindowEndMin).toBe("570");
    expect(params.prefillCutoffMins).toBe("29");
  });

  it("keeps recurring schedule metadata when duplicated", () => {
    const params = buildReuseDealPrefillParams(
      {
        title: "BOGO latte",
        description: "Buy one iced latte, get one free.",
        price: 5,
        poster_storage_path: "biz-1/latte.jpg",
        is_recurring: true,
        days_of_week: [1, 5],
        window_start_minutes: 540,
        window_end_minutes: 660,
        timezone: "America/Chicago",
        max_claims: 25,
        claim_cutoff_buffer_minutes: 10,
      },
      { resetSchedule: true, now: new Date("2026-07-01T17:00:00.000Z") },
    );

    expect(params).toMatchObject({
      prefillIsRecurring: "1",
      prefillDaysOfWeek: "1,5",
      prefillWindowStartMin: "540",
      prefillWindowEndMin: "660",
      prefillTimezone: "America/Chicago",
      prefillMaxClaims: "25",
      prefillCutoffMins: "10",
    });
    expect(params).not.toHaveProperty("prefillStartTime");
    expect(params).not.toHaveProperty("prefillEndTime");
  });

  it("strips stale generated disclosure text when resetting duplicated deal drafts", () => {
    const params = buildReuseDealPrefillParams(
      {
        title: "Iced Americano Deal",
        description:
          "Get 40% off one iced americano. Redeem only at 9460 N MacArthur Blvd, Irving, TX 75063, USA. Limited to 10 available. Offer window: One-time: 7/3/2026, 8:08:00 PM to 7/3/2026, 9:08:00 PM. Claims close 15 minutes before the deal ends. Limit one claim per customer.",
        price: 5,
        deal_type: "PERCENT_OFF_SINGLE_ITEM",
        discount_percent: 40,
        item_description: "iced americano",
        item_retail_value_cents: 500,
        is_recurring: false,
        max_claims: 10,
        claim_cutoff_buffer_minutes: 15,
      },
      { resetSchedule: true, now: new Date("2026-07-04T15:00:00.000Z") },
    );

    expect(params).toMatchObject({
      prefillHint: "Get 40% off one iced americano.",
      prefillDescription: "Get 40% off one iced americano.",
      prefillStartTime: "2026-07-04T15:05:00.000Z",
      prefillEndTime: "2026-07-04T16:05:00.000Z",
      prefillMaxClaims: "10",
      prefillCutoffMins: "15",
    });
    expect(params.prefillDescription).not.toContain("7/3/2026");
    expect(params.prefillDescription).not.toContain("Offer window");
    expect(params.prefillDescription).not.toContain("Claims close");
    expect(params.prefillDescription).not.toContain("Limit one claim");
  });

  it("splits stored listing body back into promo and details fields", () => {
    expect(
      buildReuseDealPrefillParams({
        title: "Lunch Twofer",
        description: "Buy one sandwich, get one free.\n\nValid after 2 PM.",
        price: 8,
      }),
    ).toMatchObject({
      prefillPromoLine: "Buy one sandwich, get one free.",
      prefillCta: "Claim deal",
      prefillDescription: "Valid after 2 PM.",
      prefillHint: "Buy one sandwich, get one free.\n\nValid after 2 PM.",
    });
  });

  it("reuses complete stored eligibility columns when present", () => {
    const params = buildReuseDealPrefillParams({
      title: "Half off cake slice",
      description: "50% off a cake slice.",
      price: 6,
      deal_type: "PERCENT_OFF_SINGLE_ITEM",
      discount_percent: 50,
      item_description: "Cake slice",
      item_retail_value_cents: 600,
    });
    expect(JSON.parse(params.prefillDealEligibility ?? "{}")).toMatchObject({
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      discountPercent: "50",
      itemDescription: "Cake slice",
      itemRetailValue: "6",
    });
  });

  it("recovers a durable storage path from legacy signed poster URLs", () => {
    expect(
      buildReuseDealPrefillParams({
        title: "Tacos",
        poster_url:
          "https://proj.supabase.co/storage/v1/object/sign/deal-photos/biz-1/tacos.jpg?token=old",
      }).prefillPosterPath,
    ).toBe("biz-1/tacos.jpg");
  });

  it("falls back to a direct poster URL when no storage path can be derived", () => {
    expect(
      buildReuseDealPrefillParams({
        title: "Sandwich",
        poster_url: "https://cdn.example.com/sandwich.jpg",
      }),
    ).toMatchObject({
      fromReuse: "1",
      prefillTitle: "Sandwich",
      prefillPosterUrl: "https://cdn.example.com/sandwich.jpg",
    });
  });
});
