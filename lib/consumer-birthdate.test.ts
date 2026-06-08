import { describe, expect, it } from "vitest";
import {
  defaultConsumerBirthdate,
  isValidBirthdateIso,
  latestValidBirthdate,
  parseBirthdateIsoToLocalDate,
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
});
