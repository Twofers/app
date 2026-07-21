import { describe, expect, it } from "vitest";

import { buildDealFormDirtySnapshot, isDealFormDirty } from "./deal-form-dirty";

describe("deal form dirty snapshots", () => {
  it("treats hydrated equivalent edit values as clean", () => {
    const initial = buildDealFormDirtySnapshot({
      validityMode: "one-time",
      title: "  Taco Tuesday  ",
      description: "Buy one taco, get one free.",
      price: 10,
      maxClaims: 50,
      cutoffMins: "15",
      startTime: "2026-07-01T18:00:00.000Z",
      endTime: "2026-07-01T20:00:00.000Z",
      publishLocationIds: ["b", "a"],
    });
    const current = buildDealFormDirtySnapshot({
      validityMode: "one-time",
      title: "Taco Tuesday",
      description: "Buy one taco, get one free.",
      price: "10.00",
      maxClaims: "50",
      cutoffMins: 15,
      startTime: new Date("2026-07-01T18:00:00.000Z"),
      endTime: new Date("2026-07-01T20:00:00.000Z"),
      publishLocationIds: ["a", "b"],
    });

    expect(isDealFormDirty(initial, current)).toBe(false);
  });

  it("counts poster-only text edits as unsaved changes", () => {
    const initial = buildDealFormDirtySnapshot({
      validityMode: "one-time",
      title: "Taco Tuesday",
      posterHeadlineText: "TACO TUESDAY TREAT",
      startTime: "2026-07-01T18:00:00.000Z",
      endTime: "2026-07-01T20:00:00.000Z",
    });
    // R12 removed posterSublineText, which this test used to vary. The poster headline is
    // now the only poster-only text field, so vary that instead — the behaviour under test
    // (a poster-only edit still counts as unsaved) is unchanged.
    const posterEdited = buildDealFormDirtySnapshot({
      validityMode: "one-time",
      title: "Taco Tuesday",
      posterHeadlineText: "TACO TUESDAY DEAL",
      startTime: "2026-07-01T18:00:00.000Z",
      endTime: "2026-07-01T20:00:00.000Z",
    });

    expect(isDealFormDirty(initial, posterEdited)).toBe(true);
    expect(isDealFormDirty(initial, initial)).toBe(false);
  });

  it("ignores hidden one-time schedule defaults but catches real edits", () => {
    const initial = buildDealFormDirtySnapshot({
      validityMode: "one-time",
      title: "Lunch BOGO",
      daysOfWeek: [1, 2, 3],
      windowStartMinutes: 540,
      windowEndMinutes: 1020,
      startTime: "2026-07-01T18:00:00.000Z",
      endTime: "2026-07-01T20:00:00.000Z",
    });
    const current = buildDealFormDirtySnapshot({
      validityMode: "one-time",
      title: "Lunch BOGO",
      daysOfWeek: [5, 6],
      windowStart: new Date("2026-06-15T07:30:00"),
      windowEnd: new Date("2026-06-15T11:00:00"),
      startTime: "2026-07-01T18:00:00.000Z",
      endTime: "2026-07-01T20:00:00.000Z",
    });

    expect(isDealFormDirty(initial, current)).toBe(false);

    const edited = buildDealFormDirtySnapshot({
      validityMode: "one-time",
      title: "Lunch BOGO!",
      startTime: "2026-07-01T18:00:00.000Z",
      endTime: "2026-07-01T20:00:00.000Z",
    });

    expect(isDealFormDirty(initial, edited)).toBe(true);
  });

  it("normalizes recurring time windows by minutes", () => {
    const initial = buildDealFormDirtySnapshot({
      validityMode: "recurring",
      title: "Happy hour",
      daysOfWeek: [5, 1, 5],
      windowStartMinutes: "1020",
      windowEndMinutes: 1140,
      timezone: "America/Chicago",
    });
    const current = buildDealFormDirtySnapshot({
      validityMode: "recurring",
      title: "Happy hour",
      daysOfWeek: [1, 5],
      windowStart: new Date("2026-06-15T17:00:00"),
      windowEnd: new Date("2026-06-15T19:00:00"),
      timezone: "America/Chicago",
    });

    expect(isDealFormDirty(initial, current)).toBe(false);
  });
});
