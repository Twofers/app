import { describe, expect, it } from "vitest";
import { getDealClaimScheduleBlock } from "./deal-time";

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
