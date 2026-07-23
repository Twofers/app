import { describe, expect, it } from "vitest";
import {
  formatValiditySummary,
  getDealClaimDeadline,
  getDealClaimScheduleBlock,
  shortTimeZoneLabel,
} from "./deal-time";

const baseRecurringDeal = {
  is_recurring: true,
  days_of_week: [1],
  window_start_minutes: 9 * 60,
  window_end_minutes: 17 * 60,
  timezone: "UTC",
  start_time: "2024-01-01T00:00:00.000Z",
  end_time: "2024-12-31T23:59:59.000Z",
  claim_cutoff_buffer_minutes: 15,
};

describe("getDealClaimScheduleBlock", () => {
  it("blocks a recurring deal on an unscheduled weekday", () => {
    const result = getDealClaimScheduleBlock(baseRecurringDeal, new Date("2024-01-02T10:00:00.000Z"));

    expect(result).toBe("not_active_today");
  });

  it("blocks a recurring deal outside its active window", () => {
    const result = getDealClaimScheduleBlock(baseRecurringDeal, new Date("2024-01-01T08:30:00.000Z"));

    expect(result).toBe("not_active_now");
  });

  it("blocks a recurring deal after today's claim cutoff", () => {
    const result = getDealClaimScheduleBlock(baseRecurringDeal, new Date("2024-01-01T16:50:00.000Z"));

    expect(result).toBe("claim_window_closed");
  });

  it("allows a recurring deal during its active claim window", () => {
    const result = getDealClaimScheduleBlock(baseRecurringDeal, new Date("2024-01-01T10:00:00.000Z"));

    expect(result).toBeNull();
  });
});

describe("formatValiditySummary", () => {
  it("formats one-time deal ranges in the deal timezone", () => {
    const result = formatValiditySummary(
      {
        is_recurring: false,
        timezone: "America/Chicago",
        start_time: "2026-06-18T02:00:00.000Z",
        end_time: "2026-06-25T02:00:00.000Z",
      },
      { lang: "en-US" },
    );

    expect(result).toBe("Jun 17, 2026, 9:00 PM → Jun 24, 2026, 9:00 PM");
  });

  it("formats end-only one-time deals in the deal timezone", () => {
    const result = formatValiditySummary(
      {
        is_recurring: false,
        timezone: "America/Chicago",
        end_time: "2026-06-25T02:00:00.000Z",
      },
      { endsVerb: "Ends", lang: "en-US" },
    );

    expect(result).toBe("Ends Jun 24, 2026, 9:00 PM");
  });

  it("uses the timezone on the deal instead of the host timezone", () => {
    const result = formatValiditySummary(
      {
        is_recurring: false,
        timezone: "UTC",
        end_time: "2026-06-25T02:00:00.000Z",
      },
      { endsVerb: "Ends", lang: "en-US" },
    );

    expect(result).toBe("Ends Jun 25, 2026, 2:00 AM");
  });

  it("renders recurring windows with a short, customer-friendly timezone (never raw IANA)", () => {
    const result = formatValiditySummary(
      {
        is_recurring: true,
        timezone: "America/Chicago",
        days_of_week: [1, 2, 3, 4, 5],
        window_start_minutes: 15 * 60 + 3,
        window_end_minutes: 23 * 60 + 3,
      },
      { lang: "en-US" },
    );

    expect(result).toContain("(CT)");
    expect(result).not.toContain("America/Chicago");
  });

  it("omits the timezone when showTimeZone is false", () => {
    const result = formatValiditySummary(
      {
        is_recurring: true,
        timezone: "America/Chicago",
        days_of_week: [1, 2, 3, 4, 5],
        window_start_minutes: 15 * 60 + 3,
        window_end_minutes: 23 * 60 + 3,
      },
      { lang: "en-US", showTimeZone: false },
    );

    expect(result).not.toContain("(");
  });
});

describe("shortTimeZoneLabel", () => {
  it("collapses US standard/daylight abbreviations to a generic label", () => {
    expect(shortTimeZoneLabel("America/Chicago")).toBe("CT");
    expect(shortTimeZoneLabel("America/New_York")).toBe("ET");
    expect(shortTimeZoneLabel("America/Los_Angeles")).toBe("PT");
  });

  it("leaves non-abbreviating zones as their short name", () => {
    expect(shortTimeZoneLabel("UTC")).toBe("UTC");
  });

  it("keeps the US abbreviation in non-English locales (F-018)", () => {
    // es/ko Intl returns a raw "GMT-5" offset for America/Chicago; the label
    // must still collapse to "CT" instead of leaking the offset to the user.
    expect(shortTimeZoneLabel("America/Chicago", "es")).toBe("CT");
    expect(shortTimeZoneLabel("America/Chicago", "ko")).toBe("CT");
    expect(shortTimeZoneLabel("America/New_York", "es")).toBe("ET");
  });
});

// S14. The feed counted down to end_time regardless of the recurring window, so the live
// Colonel's Brew deal ("Mon-Fri 3:03 PM-11:03 PM", ending on the 30th) advertised
// "8d 7h left" at 3:12 PM when the real answer was 7h 51m.
describe("getDealClaimDeadline", () => {
  const colonelsBrew = {
    is_recurring: true,
    days_of_week: [1, 2, 3, 4, 5],
    window_start_minutes: 15 * 60 + 3,
    window_end_minutes: 23 * 60 + 3,
    timezone: "UTC",
    start_time: "2026-06-30T00:00:00.000Z",
    end_time: "2026-07-30T03:41:00.000Z",
  };

  it("counts down to today's window close, not the campaign end date", () => {
    // Tuesday 15:12 UTC, inside the window. Campaign ends in 8 days; the window closes in
    // 7h 51m, and that is what a shopper actually has.
    const deadline = getDealClaimDeadline(colonelsBrew, new Date("2026-07-21T15:12:00.000Z"));

    expect(deadline?.toISOString()).toBe("2026-07-21T23:03:00.000Z");
    const hoursLeft = (deadline!.getTime() - new Date("2026-07-21T15:12:00.000Z").getTime()) / 3_600_000;
    expect(hoursLeft).toBeCloseTo(7.85, 1);
  });

  it("never reports a deadline beyond the campaign end", () => {
    // Last day: the window would close at 23:03 but the deal ends at 03:41 that morning.
    const deadline = getDealClaimDeadline(colonelsBrew, new Date("2026-07-30T03:00:00.000Z"));

    expect(deadline?.toISOString()).toBe("2026-07-30T03:41:00.000Z");
  });

  it("leaves non-recurring deals counting down to end_time", () => {
    const oneOff = { ...colonelsBrew, is_recurring: false };

    expect(getDealClaimDeadline(oneOff, new Date("2026-07-21T15:12:00.000Z"))?.toISOString()).toBe(
      "2026-07-30T03:41:00.000Z",
    );
  });

  it("falls back to end_time rather than losing the countdown when the schedule is unusable", () => {
    const now = new Date("2026-07-21T15:12:00.000Z");

    // No days configured.
    expect(getDealClaimDeadline({ ...colonelsBrew, days_of_week: [] }, now)?.toISOString()).toBe(
      "2026-07-30T03:41:00.000Z",
    );
    // Not running today (Tuesday is 2).
    expect(getDealClaimDeadline({ ...colonelsBrew, days_of_week: [0, 6] }, now)?.toISOString()).toBe(
      "2026-07-30T03:41:00.000Z",
    );
    // Missing window end.
    expect(getDealClaimDeadline({ ...colonelsBrew, window_end_minutes: null }, now)?.toISOString()).toBe(
      "2026-07-30T03:41:00.000Z",
    );
    // No end time at all.
    expect(getDealClaimDeadline({ ...colonelsBrew, end_time: null }, now)).toBeNull();
  });
});
