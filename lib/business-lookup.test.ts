import { describe, expect, it } from "vitest";

import {
  normalizeBusinessLookupResults,
  resolveBusinessDetailsSource,
  type BusinessLookupResult,
} from "./business-lookup";

const googleResult: BusinessLookupResult = {
  name: "Verified Coffee",
  formatted_address: "100 Main St, Dallas, TX 75201",
  phone: "(214) 555-0100",
  lat: 32.78,
  lng: -96.8,
  category: "Coffee shop",
  hours_text: "Monday: 7 AM - 3 PM",
  website: "https://example.com",
  place_id: "ChIJverified",
  source: "google_places",
};

describe("business lookup result normalization", () => {
  it("keeps verified Google Places results", () => {
    expect(normalizeBusinessLookupResults({ results: [googleResult] })).toEqual([googleResult]);
  });

  it("returns an empty list when Google has no results", () => {
    expect(normalizeBusinessLookupResults({ results: [] })).toEqual([]);
  });

  it("rejects API failure bodies as no usable result data", () => {
    expect(
      normalizeBusinessLookupResults({
        error: "Business lookup failed. Try another search or enter details manually.",
        error_code: "BUSINESS_LOOKUP_API_FAILURE",
      }),
    ).toEqual([]);
  });

  it("does not allow AI-estimated factual fields through", () => {
    expect(
      normalizeBusinessLookupResults({
        results: [
          {
            ...googleResult,
            place_id: "",
            source: "ai_unverified",
          },
          {
            ...googleResult,
            source: "ai_estimate",
          },
        ],
      }),
    ).toEqual([]);
  });

  it("preserves the manual-entry source path", () => {
    expect(resolveBusinessDetailsSource(null)).toBe("manual");
    expect(resolveBusinessDetailsSource(googleResult)).toBe("google_places");
  });
});
