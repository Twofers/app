import { describe, expect, it } from "vitest";

import {
  createDefaultOneTimeDealSchedule,
  createOneTimeDealScheduleFromStart,
  dealDurationExceedsMax,
  MAX_DEAL_DURATION_MINUTES,
} from "./deal-schedule-defaults";

describe("deal schedule defaults", () => {
  it("starts a new one-time deal five minutes from now and ends it one hour later", () => {
    const now = new Date("2026-06-30T17:20:30.000Z");

    const schedule = createDefaultOneTimeDealSchedule(now);

    expect(schedule.startTime.toISOString()).toBe("2026-06-30T17:25:30.000Z");
    expect(schedule.endTime.toISOString()).toBe("2026-06-30T18:25:30.000Z");
  });

  it("keeps the end time one hour after a chosen start time", () => {
    const schedule = createOneTimeDealScheduleFromStart(new Date("2026-06-30T21:05:00.000Z"));

    expect(schedule.startTime.toISOString()).toBe("2026-06-30T21:05:00.000Z");
    expect(schedule.endTime.toISOString()).toBe("2026-06-30T22:05:00.000Z");
  });

  it("caps deal duration at 4 hours", () => {
    expect(MAX_DEAL_DURATION_MINUTES).toBe(240);
    expect(dealDurationExceedsMax(60)).toBe(false);
    expect(dealDurationExceedsMax(240)).toBe(false);
    expect(dealDurationExceedsMax(241)).toBe(true);
  });
});
