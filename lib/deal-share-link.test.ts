import { describe, expect, it } from "vitest";

import { interpretShareLookup, parseShareLink } from "./deal-share-link";

describe("parseShareLink", () => {
  it("extracts a valid share code from the public share URL", () => {
    expect(parseShareLink("https://www.twoferapp.com/s/ABCD234")).toEqual({
      type: "code",
      code: "ABCD234",
    });
  });

  it("normalizes lowercase codes and trailing slashes", () => {
    expect(parseShareLink("https://www.twoferapp.com/s/abcd234/")).toEqual({
      type: "code",
      code: "ABCD234",
    });
  });

  it("extracts native share links normalized by Expo Router", () => {
    expect(parseShareLink("twoforone://s/ABCD234")).toEqual({
      type: "code",
      code: "ABCD234",
    });
    expect(parseShareLink("twofer://s/abcd234/")).toEqual({
      type: "code",
      code: "ABCD234",
    });
    expect(parseShareLink("twoforone:///s/ABCD234")).toEqual({
      type: "code",
      code: "ABCD234",
    });
  });

  it("accepts the apex-domain and query/fragment variants", () => {
    expect(parseShareLink("https://twoferapp.com/s/XYZRSTU?utm=share#x")).toEqual({
      type: "code",
      code: "XYZRSTU",
    });
  });

  it("flags share paths with malformed codes as invalid", () => {
    // 0, O, I, L, 1 are excluded from the share alphabet.
    expect(parseShareLink("https://www.twoferapp.com/s/ABC0123")).toEqual({ type: "invalid" });
    expect(parseShareLink("https://www.twoferapp.com/s/TOOSHRT2")).toEqual({ type: "invalid" });
    expect(parseShareLink("https://www.twoferapp.com/s/AB")).toEqual({ type: "invalid" });
    expect(parseShareLink("https://www.twoferapp.com/s/%E2%98%83%E2%98%83%E2%98%83")).toEqual({
      type: "invalid",
    });
  });

  it("ignores URLs that are not share links", () => {
    expect(parseShareLink(null)).toEqual({ type: "none" });
    expect(parseShareLink("")).toEqual({ type: "none" });
    expect(parseShareLink("not a url")).toEqual({ type: "none" });
    expect(parseShareLink("https://www.twoferapp.com/")).toEqual({ type: "none" });
    expect(parseShareLink("https://www.twoferapp.com/s")).toEqual({ type: "none" });
    expect(parseShareLink("https://www.twoferapp.com/s/ABCD234/extra")).toEqual({ type: "none" });
    expect(parseShareLink("https://www.twoferapp.com/privacy")).toEqual({ type: "none" });
  });

  it("ignores the existing custom-scheme and edge-function deal links", () => {
    expect(
      parseShareLink("twoforone://deal/123e4567-e89b-42d3-a456-426614174000"),
    ).toEqual({ type: "none" });
    expect(
      parseShareLink(
        "https://kvodhiqhdqnptqovovia.supabase.co/functions/v1/deal-link?id=123e4567-e89b-42d3-a456-426614174000",
      ),
    ).toEqual({ type: "none" });
  });
});

describe("interpretShareLookup", () => {
  const dealId = "123e4567-e89b-42d3-a456-426614174000";

  it("resolves a valid share to its deal id", () => {
    expect(
      interpretShareLookup([{ share_status: "valid", deal_id: dealId }], null),
    ).toEqual({ status: "valid", dealId });
  });

  it("accepts a single-row (non-array) payload", () => {
    expect(
      interpretShareLookup({ share_status: "valid", deal_id: dealId }, null),
    ).toEqual({ status: "valid", dealId });
  });

  it("treats invalid, not_found, and expired statuses as unavailable", () => {
    for (const share_status of ["invalid", "not_found", "expired"]) {
      expect(interpretShareLookup([{ share_status, deal_id: null }], null)).toEqual({
        status: "unavailable",
      });
    }
  });

  it("treats empty results as unavailable", () => {
    expect(interpretShareLookup([], null)).toEqual({ status: "unavailable" });
    expect(interpretShareLookup(null, null)).toEqual({ status: "unavailable" });
  });

  it("treats a valid status without a usable deal id as unavailable", () => {
    expect(interpretShareLookup([{ share_status: "valid", deal_id: null }], null)).toEqual({
      status: "unavailable",
    });
    expect(
      interpretShareLookup([{ share_status: "valid", deal_id: "not-a-uuid" }], null),
    ).toEqual({ status: "unavailable" });
  });

  it("reports RPC errors as error", () => {
    expect(interpretShareLookup(null, { message: "network down" })).toEqual({
      status: "error",
    });
  });
});

describe("share-code fast-fail copies stay in sync across runtimes", () => {
  // The 7-char share-code alphabet is defined authoritatively by the
  // lookup_deal_share RPC and lib/share-deal.ts generation; the web landing
  // (website/s/index.html) and the deal-share-lookup edge function carry
  // fast-fail copies because browser inline JS / Deno / RN share no build
  // step. If the alphabet or length ever changes, these copies must move
  // together or valid share links start rendering as "not available".
  it("edge function and web landing embed the canonical pattern", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const canonical = "[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{7}";
    const fnSource = readFileSync(
      join(process.cwd(), "supabase", "functions", "deal-share-lookup", "index.ts"),
      "utf8",
    );
    const pageSource = readFileSync(join(process.cwd(), "website", "s", "index.html"), "utf8");
    expect(fnSource).toContain(canonical);
    expect(pageSource).toContain(canonical);
    // And both must match what the parser here accepts.
    expect(parseShareLink(`https://www.twoferapp.com/s/ABCD234`)).toEqual({ type: "code", code: "ABCD234" });
  });
});
