import { describe, expect, it } from "vitest";
import {
  clampConsumerBirthdate,
  defaultConsumerBirthdate,
  earliestValidBirthdate,
  isValidBirthdateIso,
  latestValidBirthdate,
  makeConsumerBirthdateFromParts,
  parseBirthdateIsoToLocalDate,
  shiftConsumerBirthdateMonths,
  shiftConsumerBirthdateYears,
  toBirthdateIso,
} from "./consumer-birthdate";

describe("consumer birthdate helpers", () => {
  const referenceDate = new Date(2026, 5, 8, 10, 30, 0, 0);

  it("computes the default and latest selectable birthday from the reference date", () => {
    expect(toBirthdateIso(defaultConsumerBirthdate(referenceDate))).toBe("2001-06-08");
    expect(toBirthdateIso(latestValidBirthdate(referenceDate))).toBe("2013-06-08");
  });

  it("validates real local dates for consumers 13 and older", () => {
    expect(isValidBirthdateIso("2013-06-08", referenceDate)).toBe(true);
    expect(isValidBirthdateIso("2013-06-09", referenceDate)).toBe(false);
    expect(isValidBirthdateIso("2013-02-29", referenceDate)).toBe(false);
    expect(isValidBirthdateIso("1899-12-31", referenceDate)).toBe(false);
  });

  it("round-trips ISO birthday strings without timezone shifts", () => {
    const parsed = parseBirthdateIsoToLocalDate("1999-01-05");
    expect(parsed).not.toBeNull();
    expect(toBirthdateIso(parsed!)).toBe("1999-01-05");
  });

  it("clamps custom picker dates to the allowed consumer age range", () => {
    expect(toBirthdateIso(earliestValidBirthdate())).toBe("1900-01-01");
    expect(toBirthdateIso(clampConsumerBirthdate(new Date(1899, 11, 31), referenceDate))).toBe("1900-01-01");
    expect(toBirthdateIso(clampConsumerBirthdate(new Date(2018, 0, 1), referenceDate))).toBe("2013-06-08");
  });

  it("builds valid dates from parts without overflowing short months", () => {
    expect(toBirthdateIso(makeConsumerBirthdateFromParts(2001, 1, 31, referenceDate))).toBe("2001-02-28");
    expect(toBirthdateIso(makeConsumerBirthdateFromParts(2000, 1, 31, referenceDate))).toBe("2000-02-29");
  });

  it("shifts custom picker months and years without invalid leap-day dates", () => {
    expect(toBirthdateIso(shiftConsumerBirthdateMonths(new Date(2001, 2, 31), -1, referenceDate))).toBe("2001-02-28");
    expect(toBirthdateIso(shiftConsumerBirthdateYears(new Date(2000, 1, 29), 1, referenceDate))).toBe("2001-02-28");
  });
});
