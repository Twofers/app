import { describe, expect, it } from "vitest";

import { buildSlowHoursSchedulePreset } from "./slow-hours-preset";

describe("buildSlowHoursSchedulePreset", () => {
  it("returns null for empty or missing rows", () => {
    expect(buildSlowHoursSchedulePreset(null)).toBeNull();
    expect(buildSlowHoursSchedulePreset([])).toBeNull();
  });

  it("ignores free-text-only rows without structured day/time data", () => {
    expect(
      buildSlowHoursSchedulePreset([
        { day_of_week: null, starts_at: null, ends_at: null },
        { day_of_week: 2, starts_at: null, ends_at: "16:00:00" },
      ]),
    ).toBeNull();
  });

  it("builds a preset from structured rows and maps Sunday (0) to 7", () => {
    const preset = buildSlowHoursSchedulePreset([
      { day_of_week: 2, starts_at: "14:00:00", ends_at: "16:30:00" },
      { day_of_week: 0, starts_at: "15:00:00", ends_at: "17:00:00" },
    ]);
    expect(preset).toEqual({ days: [2, 7], startMin: 14 * 60, endMin: 17 * 60 });
  });

  it("dedupes repeated days and sorts them", () => {
    const preset = buildSlowHoursSchedulePreset([
      { day_of_week: 3, starts_at: "13:00", ends_at: "15:00" },
      { day_of_week: 3, starts_at: "13:30", ends_at: "15:30" },
      { day_of_week: 1, starts_at: "14:00", ends_at: "16:00" },
    ]);
    expect(preset).toEqual({ days: [1, 3], startMin: 13 * 60, endMin: 16 * 60 });
  });

  it("clamps windows longer than the 4-hour deal duration cap", () => {
    const preset = buildSlowHoursSchedulePreset([
      { day_of_week: 2, starts_at: "10:00:00", ends_at: "20:00:00" },
    ]);
    expect(preset).toEqual({ days: [2], startMin: 10 * 60, endMin: 14 * 60 });
  });

  it("rejects inverted or zero-length windows", () => {
    expect(
      buildSlowHoursSchedulePreset([{ day_of_week: 4, starts_at: "18:00:00", ends_at: "18:00:00" }]),
    ).toBeNull();
    expect(
      buildSlowHoursSchedulePreset([{ day_of_week: 4, starts_at: "20:00:00", ends_at: "10:00:00" }]),
    ).toBeNull();
  });

  it("rejects malformed times and out-of-range days", () => {
    expect(
      buildSlowHoursSchedulePreset([
        { day_of_week: 9, starts_at: "14:00:00", ends_at: "16:00:00" },
        { day_of_week: 2, starts_at: "not a time", ends_at: "16:00:00" },
      ]),
    ).toBeNull();
  });
});
