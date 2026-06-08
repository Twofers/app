import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  devWarn: vi.fn(),
  getUser: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("./supabase", () => ({
  supabase: {
    auth: { getUser: mocks.getUser },
    functions: { invoke: mocks.invoke },
  },
}));

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
}));

vi.mock("expo-constants", () => ({
  default: {
    executionEnvironment: "standalone",
    expoConfig: { version: "1.0.0" },
  },
}));

vi.mock("./dev-log", () => ({
  devWarn: mocks.devWarn,
}));

import { aiBusinessLookup, aiBusinessLookupDetails } from "./functions";
import type { BusinessLookupResult } from "./business-lookup";

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

describe("business lookup function client", () => {
  beforeEach(() => {
    mocks.devWarn.mockReset();
    mocks.getUser.mockReset();
    mocks.invoke.mockReset();
  });

  it("returns verified Google results from a business-name search", async () => {
    mocks.invoke.mockResolvedValue({ data: { ok: true, results: [googleResult] }, error: null });

    await expect(aiBusinessLookup({ business_name: "Verified Coffee" })).resolves.toEqual([googleResult]);
    expect(mocks.invoke).toHaveBeenCalledWith(
      "ai-business-lookup",
      expect.objectContaining({
        body: {
          business_name: "Verified Coffee",
          lat: undefined,
          lng: undefined,
        },
      }),
    );
  });

  it("returns an empty list when no verified result is found", async () => {
    mocks.invoke.mockResolvedValue({ data: { ok: true, results: [] }, error: null });

    await expect(aiBusinessLookup({ business_name: "Missing Coffee" })).resolves.toEqual([]);
  });

  it("throws on API failure instead of falling back to invented fields", async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: {
        message: "Business lookup failed. Try another search or enter details manually.",
      },
    });

    await expect(aiBusinessLookup({ business_name: "Verified Coffee" })).rejects.toThrow(
      "Business lookup failed",
    );
  });

  it("drops stale AI-estimated factual fields from older responses", async () => {
    mocks.invoke.mockResolvedValue({
      data: {
        ok: true,
        results: [
          {
            ...googleResult,
            source: "ai_estimate",
          },
        ],
      },
      error: null,
    });

    await expect(aiBusinessLookup({ business_name: "Verified Coffee" })).resolves.toEqual([]);
    expect(mocks.devWarn).toHaveBeenCalled();
  });

  it("requests Place Details by place_id after selection", async () => {
    mocks.invoke.mockResolvedValue({ data: { ok: true, results: [googleResult] }, error: null });

    await expect(aiBusinessLookupDetails({ place_id: "ChIJverified" })).resolves.toEqual(googleResult);
    expect(mocks.invoke).toHaveBeenCalledWith(
      "ai-business-lookup",
      expect.objectContaining({
        body: {
          action: "details",
          place_id: "ChIJverified",
        },
      }),
    );
  });
});
