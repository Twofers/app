import { describe, expect, it } from "vitest";

import { buildReuseDealPrefillParams } from "./reuse-deal-prefill";

describe("reuse deal prefill params", () => {
  it("copies publishable content, schedule metadata, and stored poster path", () => {
    expect(
      buildReuseDealPrefillParams({
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
      }),
    ).toEqual({
      fromReuse: "1",
      prefillTitle: "BOGO latte",
      prefillHint: "Buy one iced latte, get one free.",
      prefillDescription: "Buy one iced latte, get one free.",
      prefillPrice: "5",
      prefillSourceLocale: "en",
      prefillPosterPath: "biz-1/latte.jpg",
      prefillIsRecurring: "1",
      prefillDaysOfWeek: "1,5",
      prefillWindowStartMin: "540",
      prefillWindowEndMin: "660",
      prefillTimezone: "America/Chicago",
      prefillMaxClaims: "25",
      prefillCutoffMins: "10",
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
