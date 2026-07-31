import { describe, expect, it } from "vitest";

import { normalizeUrlOrHandle } from "./business-onboarding-sync.ts";

describe("normalizeUrlOrHandle", () => {
  it("treats a leading @ as an Instagram handle and drops the @", () => {
    expect(normalizeUrlOrHandle("@joescoffee")).toEqual({ type: "instagram", value: "joescoffee" });
  });

  it("classifies real Instagram URLs by hostname", () => {
    for (const value of [
      "instagram.com/joescoffee",
      "https://instagram.com/joescoffee",
      "https://www.instagram.com/joescoffee",
      "HTTPS://Instagram.COM/joescoffee",
    ]) {
      expect(normalizeUrlOrHandle(value).type).toBe("instagram");
    }
  });

  // The substring check this replaced filed any URL merely containing
  // "instagram.com" under the merchant's Instagram channel.
  it("does not treat an unrelated host as Instagram", () => {
    for (const value of [
      "https://evil.example/instagram.com/joescoffee",
      "https://instagram.com.evil.example/joescoffee",
      "https://notinstagram.com/joescoffee",
      "https://evil.example/?next=instagram.com",
    ]) {
      expect(normalizeUrlOrHandle(value).type).toBe("website");
    }
  });

  it("still recognises plain websites and bare domains", () => {
    expect(normalizeUrlOrHandle("https://joescoffee.com")).toEqual({
      type: "website",
      value: "https://joescoffee.com",
    });
    expect(normalizeUrlOrHandle("joescoffee.com")).toEqual({
      type: "website",
      value: "https://joescoffee.com",
    });
  });

  it("falls back to a bare handle when the value is neither a URL nor @-prefixed", () => {
    expect(normalizeUrlOrHandle("joescoffee")).toEqual({ type: "instagram", value: "joescoffee" });
  });

  it("returns nulls for empty input", () => {
    expect(normalizeUrlOrHandle(null)).toEqual({ type: null, value: null });
    expect(normalizeUrlOrHandle("   ")).toEqual({ type: null, value: null });
  });
});
