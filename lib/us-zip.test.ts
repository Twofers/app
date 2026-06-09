import { describe, expect, it } from "vitest";
import { isValidUsZipFormat, normalizeUsZipInput, parseUsZipFiveDigits, sanitizeUsZipInput } from "./us-zip";

describe("us-zip", () => {
  it("normalizes spaces", () => {
    expect(normalizeUsZipInput("  75 063  ")).toBe("75063");
  });

  it("sanitizes typed input to five digits", () => {
    expect(sanitizeUsZipInput("75 063-1234")).toBe("75063");
    expect(sanitizeUsZipInput("abc123456")).toBe("12345");
  });

  it("accepts only 5-digit ZIPs", () => {
    expect(isValidUsZipFormat("75063")).toBe(true);
    expect(isValidUsZipFormat("75063-1234")).toBe(false);
    expect(isValidUsZipFormat("7506")).toBe(false);
    expect(isValidUsZipFormat("750631")).toBe(false);
    expect(isValidUsZipFormat("abcde")).toBe(false);
  });

  it("parses five-digit prefix", () => {
    expect(parseUsZipFiveDigits("75063")).toBe("75063");
    expect(parseUsZipFiveDigits("75063-1234")).toBe(null);
    expect(parseUsZipFiveDigits("7506")).toBe(null);
  });
});
