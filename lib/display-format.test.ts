import { describe, expect, it } from "vitest";

import { compactLocationLabel, formatPhoneLabel } from "./display-format";

describe("compactLocationLabel", () => {
  it("keeps short city-state values untouched", () => {
    expect(compactLocationLabel("Grapevine, TX")).toBe("Grapevine, TX");
  });

  it("compacts a full US geocoder address to City, ST", () => {
    expect(compactLocationLabel("9460 N MacArthur Blvd, Irving, TX 75063, USA")).toBe("Irving, TX");
  });

  it("compacts when there is no trailing country", () => {
    expect(compactLocationLabel("123 Main St, Dallas, TX 75201")).toBe("Dallas, TX");
  });

  it("handles a plain state part without a ZIP", () => {
    expect(compactLocationLabel("123 Main St, Dallas, TX, USA")).toBe("Dallas, TX");
  });

  it("leaves unrecognized formats untouched", () => {
    expect(compactLocationLabel("Suite 4, Building 9, Campus West")).toBe("Suite 4, Building 9, Campus West");
    expect(compactLocationLabel("Calle 50, Ciudad de Panamá, Panamá")).toBe("Calle 50, Ciudad de Panamá, Panamá");
  });

  it("handles empty input", () => {
    expect(compactLocationLabel(null)).toBe("");
    expect(compactLocationLabel("  ")).toBe("");
  });
});

describe("formatPhoneLabel", () => {
  it("formats E.164 US numbers", () => {
    expect(formatPhoneLabel("+12142366549")).toBe("(214) 236-6549");
  });

  it("formats bare 10-digit numbers", () => {
    expect(formatPhoneLabel("2142366549")).toBe("(214) 236-6549");
  });

  it("keeps already formatted numbers stable", () => {
    expect(formatPhoneLabel("(214) 236-6549")).toBe("(214) 236-6549");
  });

  it("returns non-US or partial numbers untouched", () => {
    expect(formatPhoneLabel("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(formatPhoneLabel("236-6549")).toBe("236-6549");
  });

  it("handles empty input", () => {
    expect(formatPhoneLabel(null)).toBe("");
  });
});
