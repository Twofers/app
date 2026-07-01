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

  it("can reset schedule metadata for duplicated deal drafts", () => {
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
      fromReuse: "1",
      prefillTitle: "Buy one latte and get one free",
      prefillPosterPath: "biz-1/latte.jpg",
      prefillIsRecurring: "0",
      prefillStartTime: "2026-07-01T17:05:00.000Z",
      prefillEndTime: "2026-07-01T18:05:00.000Z",
      prefillMaxClaims: "25",
      prefillCutoffMins: "10",
    });
    expect(params).not.toHaveProperty("prefillDaysOfWeek");
    expect(params).not.toHaveProperty("prefillWindowStartMin");
    expect(params).not.toHaveProperty("prefillWindowEndMin");
    expect(params).not.toHaveProperty("prefillTimezone");
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
