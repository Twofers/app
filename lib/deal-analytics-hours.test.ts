import { describe, expect, it } from "vitest";
import {
  bucketStartHour,
  getLocalDayAndHour,
  normalizeTimestamp,
  periodForBucketStart,
  to12Hour,
} from "./deal-analytics-hours";

describe("normalizeTimestamp", () => {
  it("leaves a Z-suffixed timestamp unchanged", () => {
    expect(normalizeTimestamp("2026-08-06T22:40:00Z")).toBe("2026-08-06T22:40:00Z");
  });

  it("leaves a +HH:MM offset timestamp unchanged", () => {
    expect(normalizeTimestamp("2026-08-06T22:40:00+00:00")).toBe("2026-08-06T22:40:00+00:00");
  });

  it("leaves a -HH:MM offset timestamp unchanged", () => {
    expect(normalizeTimestamp("2026-08-06T22:40:00-05:00")).toBe("2026-08-06T22:40:00-05:00");
  });

  it("appends Z to an offset-less timestamp so it is not parsed as device-local", () => {
    expect(normalizeTimestamp("2026-08-06T22:40:00")).toBe("2026-08-06T22:40:00Z");
  });
});

describe("getLocalDayAndHour", () => {
  it("buckets a 10:40 PM America/Chicago claim to hour 22, not 3 AM UTC", () => {
    // 10:40 PM CDT == 03:40 UTC the next day — the live bug this regression-tests.
    const createdAt = "2026-08-06T22:40:00-05:00";

    // Sanity check: confirm this timestamp really does land at 3 AM UTC, which is the
    // device-timezone reading that produced the wrong "Busiest around 3:00 AM local".
    expect(new Date(createdAt).getUTCHours()).toBe(3);

    const { hour, day } = getLocalDayAndHour(createdAt, "America/Chicago");
    expect(hour).toBe(22);
    expect(day).toBe(new Date(Date.UTC(2026, 7, 6)).getUTCDay());
  });

  it("falls back to the device timezone without throwing when timezone is null", () => {
    expect(() => getLocalDayAndHour("2026-08-06T10:00:00Z", null)).not.toThrow();
    const { hour, day } = getLocalDayAndHour("2026-08-06T10:00:00Z", null);
    expect(hour).toBeGreaterThanOrEqual(0);
    expect(hour).toBeLessThanOrEqual(23);
    expect(day).toBeGreaterThanOrEqual(0);
    expect(day).toBeLessThanOrEqual(6);
  });

  it("falls back to the device timezone without throwing when timezone is undefined", () => {
    expect(() => getLocalDayAndHour("2026-08-06T10:00:00Z")).not.toThrow();
  });

  it("falls back to the device timezone without throwing when timezone is blank", () => {
    expect(() => getLocalDayAndHour("2026-08-06T10:00:00Z", "   ")).not.toThrow();
  });

  it("does not crash on an invalid IANA timezone string", () => {
    expect(() => getLocalDayAndHour("2026-08-06T10:00:00Z", "Not/ARealZone")).not.toThrow();
    const { hour, day } = getLocalDayAndHour("2026-08-06T10:00:00Z", "Not/ARealZone");
    expect(hour).toBeGreaterThanOrEqual(0);
    expect(hour).toBeLessThanOrEqual(23);
    expect(day).toBeGreaterThanOrEqual(0);
    expect(day).toBeLessThanOrEqual(6);
  });
});

describe("bucketStartHour", () => {
  it("floors an hour to its 2-hour bucket start", () => {
    expect(bucketStartHour(22)).toBe(22);
    expect(bucketStartHour(23)).toBe(22);
    expect(bucketStartHour(0)).toBe(0);
    expect(bucketStartHour(1)).toBe(0);
    expect(bucketStartHour(15)).toBe(14);
  });
});

describe("periodForBucketStart", () => {
  it("labels a 10 PM bucket as PM, not AM", () => {
    // Regression for the live bug: the old code derived the period from the bucket's END
    // hour, so a 10 PM bucket (end hour 0) read as "AM" for a 10 PM peak.
    expect(periodForBucketStart(22)).toBe("PM");
  });

  it("labels a midnight bucket as AM", () => {
    expect(periodForBucketStart(0)).toBe("AM");
  });

  it("labels a noon bucket as PM", () => {
    expect(periodForBucketStart(12)).toBe("PM");
  });

  it("labels an 11 AM bucket as AM", () => {
    expect(periodForBucketStart(10)).toBe("AM");
  });
});

describe("to12Hour", () => {
  it("converts midnight and noon to 12", () => {
    expect(to12Hour(0)).toBe(12);
    expect(to12Hour(12)).toBe(12);
  });

  it("converts other hours to their 12-hour equivalent", () => {
    expect(to12Hour(22)).toBe(10);
    expect(to12Hour(1)).toBe(1);
    expect(to12Hour(13)).toBe(1);
  });
});
