import { describe, expect, it } from "vitest";
import {
  WALLET_PASS_REDEEMED_FRESH_HOURS,
  WALLET_PASS_SCAN_PREFIX,
  buildGoogleSaveJwtClaims,
  buildGoogleWalletGenericObject,
  buildGoogleWalletObjectId,
  buildShortCodeScanValue,
  buildWalletPassContent,
  deriveWalletPassState,
  formatWalletPassDateTime,
  formatWalletShortCode,
  parseShortCodeScanValue,
  resolveWalletPassLocale,
  type WalletPassClaimRow,
} from "./wallet-pass-content.ts";

const NOW = Date.UTC(2026, 6, 11, 18, 0, 0); // 2026-07-11 18:00Z
const HOUR = 3_600_000;

function claimRow(overrides: Partial<WalletPassClaimRow> = {}): WalletPassClaimRow {
  return {
    claim_status: "active",
    redeemed_at: null,
    expires_at: new Date(NOW + 2 * HOUR).toISOString(),
    grace_period_minutes: 10,
    short_code: "ABC123",
    created_at: new Date(NOW - HOUR).toISOString(),
    deal_title: "Buy one latte, get one free",
    deal_title_en: "Buy one latte, get one free",
    deal_title_es: "Compra un latte y llévate otro gratis",
    deal_title_ko: "라떼 1+1",
    deal_timezone: "America/Chicago",
    business_name: "Maya's Café",
    business_address: "123 Main St, Dallas",
    business_latitude: 32.78,
    business_longitude: -96.8,
    is_demo: false,
    ...overrides,
  };
}

describe("short-code scan scheme", () => {
  it("builds and parses a round trip", () => {
    const value = buildShortCodeScanValue("ABC123");
    expect(value).toBe(`${WALLET_PASS_SCAN_PREFIX}ABC123`);
    expect(parseShortCodeScanValue(value)).toBe("ABC123");
  });

  it("is case-insensitive and normalizes separators", () => {
    expect(parseShortCodeScanValue("TWOFER://REDEEM/SC/abc-123")).toBe("ABC123");
    expect(parseShortCodeScanValue("  twofer://redeem/sc/abc 123  ")).toBe("ABC123");
  });

  it("never captures classic token URIs — those must keep flowing to the token lookup", () => {
    expect(parseShortCodeScanValue("twofer://redeem/0a1b2c3d-1111-2222-3333-444455556666")).toBeNull();
  });

  it("rejects garbage, wrong schemes, and implausible codes", () => {
    expect(parseShortCodeScanValue("")).toBeNull();
    expect(parseShortCodeScanValue(null)).toBeNull();
    expect(parseShortCodeScanValue("https://evil.example/sc/ABC123")).toBeNull();
    expect(parseShortCodeScanValue("twofer://redeem/sc/")).toBeNull();
    expect(parseShortCodeScanValue("twofer://redeem/sc/AB")).toBeNull(); // < 4 chars
    expect(parseShortCodeScanValue(`twofer://redeem/sc/${"A".repeat(20)}`)).toBeNull();
    expect(buildShortCodeScanValue("")).toBeNull();
    expect(buildShortCodeScanValue("ab")).toBeNull();
  });

  it("formats codes with the same 3+3 grouping staff see in the app", () => {
    expect(formatWalletShortCode("ABC123")).toBe("ABC 123");
  });
});

describe("resolveWalletPassLocale", () => {
  it("accepts es/ko and defaults everything else to en", () => {
    expect(resolveWalletPassLocale("es")).toBe("es");
    expect(resolveWalletPassLocale(" KO ")).toBe("ko");
    expect(resolveWalletPassLocale("fr")).toBe("en");
    expect(resolveWalletPassLocale(null)).toBe("en");
  });
});

describe("deriveWalletPassState", () => {
  it("shows the live claim with a scannable code", () => {
    const state = deriveWalletPassState([claimRow()], NOW, "en");
    expect(state.kind).toBe("active_deal");
    if (state.kind !== "active_deal") return;
    expect(state.shortCode).toBe("ABC123");
    expect(state.businessName).toBe("Maya's Café");
    // Redeem-by = expires_at + grace.
    expect(state.redeemByIso).toBe(new Date(NOW + 2 * HOUR + 10 * 60_000).toISOString());
    expect(state.latitude).toBe(32.78);
  });

  it("prefers the live claim over a fresher redeemed one", () => {
    const redeemed = claimRow({
      claim_status: "redeemed",
      redeemed_at: new Date(NOW - 5 * 60_000).toISOString(),
      created_at: new Date(NOW - 4 * 60_000).toISOString(),
    });
    const state = deriveWalletPassState([redeemed, claimRow()], NOW, "en");
    expect(state.kind).toBe("active_deal");
  });

  it("skips demo offers, past-deadline claims, and claims without short codes", () => {
    expect(deriveWalletPassState([claimRow({ is_demo: true })], NOW, "en").kind).toBe("no_deal");
    expect(
      deriveWalletPassState(
        [claimRow({ expires_at: new Date(NOW - HOUR).toISOString() })],
        NOW,
        "en",
      ).kind,
    ).toBe("no_deal");
    expect(deriveWalletPassState([claimRow({ short_code: null })], NOW, "en").kind).toBe("no_deal");
  });

  it("still honors the grace window right after expires_at", () => {
    const state = deriveWalletPassState(
      [claimRow({ expires_at: new Date(NOW - 5 * 60_000).toISOString() })],
      NOW,
      "en",
    );
    expect(state.kind).toBe("active_deal"); // 5 min past end, inside 10-min grace
  });

  it("shows Redeemed within the freshness window, then returns to no_deal", () => {
    const base = claimRow({ claim_status: "redeemed" });
    const fresh = { ...base, redeemed_at: new Date(NOW - HOUR).toISOString() };
    const stale = {
      ...base,
      redeemed_at: new Date(NOW - (WALLET_PASS_REDEEMED_FRESH_HOURS + 1) * HOUR).toISOString(),
    };
    expect(deriveWalletPassState([fresh], NOW, "en").kind).toBe("redeemed");
    expect(deriveWalletPassState([stale], NOW, "en").kind).toBe("no_deal");
  });

  it("ignores canceled/released/expired claims entirely", () => {
    for (const status of ["canceled", "released", "expired"]) {
      expect(deriveWalletPassState([claimRow({ claim_status: status })], NOW, "en").kind).toBe("no_deal");
    }
  });

  it("localizes the deal title with fallback to the source title", () => {
    const state = deriveWalletPassState([claimRow()], NOW, "es");
    if (state.kind !== "active_deal") throw new Error("expected active");
    expect(state.dealTitle).toBe("Compra un latte y llévate otro gratis");
    const noEs = deriveWalletPassState([claimRow({ deal_title_es: null })], NOW, "es");
    if (noEs.kind !== "active_deal") throw new Error("expected active");
    expect(noEs.dealTitle).toBe("Buy one latte, get one free");
  });

  it("returns no_deal for empty history", () => {
    expect(deriveWalletPassState([], NOW, "en").kind).toBe("no_deal");
  });
});

describe("buildWalletPassContent", () => {
  const activeState = deriveWalletPassState([claimRow()], NOW, "en");

  it("active: barcode carries the sc scheme with the staff-readable code as altText", () => {
    const content = buildWalletPassContent(activeState, "en");
    expect(content.barcode?.value).toBe("twofer://redeem/sc/ABC123");
    expect(content.barcode?.alternateText).toBe("ABC 123");
    expect(content.header).toBe("Buy one latte, get one free");
    expect(content.rows.map((r) => r.id)).toEqual(["business", "redeem_by", "code"]);
    expect(content.validUntilIso).not.toBeNull();
    expect(content.latitude).toBe(32.78);
  });

  it("renders es and ko strings", () => {
    const es = buildWalletPassContent({ kind: "no_deal" }, "es");
    expect(es.header).toBe("Sin oferta activa");
    const ko = buildWalletPassContent(
      { kind: "redeemed", dealTitle: "라떼 1+1", businessName: null, redeemedAtIso: new Date(NOW).toISOString() },
      "ko",
    );
    expect(ko.header).toBe("사용 완료 🎉");
  });

  it("redeemed and no_deal never carry a barcode or expiry", () => {
    for (const content of [
      buildWalletPassContent(
        { kind: "redeemed", dealTitle: "x", businessName: "y", redeemedAtIso: new Date(NOW).toISOString() },
        "en",
      ),
      buildWalletPassContent({ kind: "no_deal" }, "en"),
    ]) {
      expect(content.barcode).toBeNull();
      expect(content.validUntilIso).toBeNull();
      expect(content.latitude).toBeNull();
    }
  });

  it("formats the redeem-by time in the deal's timezone and locale", () => {
    const iso = new Date(Date.UTC(2026, 6, 11, 19, 0, 0)).toISOString();
    expect(formatWalletPassDateTime(iso, "America/Chicago", "en")).toMatch(/Jul 11, 2:00\sPM/);
    expect(formatWalletPassDateTime(iso, "not-a-tz", "en")).toBe(new Date(iso).toISOString());
  });
});

describe("Google Wallet object builder", () => {
  const issuerId = "3388000000012345678";
  const objectId = buildGoogleWalletObjectId(issuerId, "0A1B2C3D-1111-2222-3333-444455556666");

  it("object id is issuer-scoped and charset-safe", () => {
    expect(objectId).toBe(`${issuerId}.twofer-card-0a1b2c3d-1111-2222-3333-444455556666`);
  });

  it("active object: barcode, validTimeInterval, brand color, subheader", () => {
    const content = buildWalletPassContent(deriveWalletPassState([claimRow()], NOW, "en"), "en");
    const object = buildGoogleWalletGenericObject(content, { issuerId, objectId, logoUrl: "https://twoferapp.com/logo.png" });
    expect(object.id).toBe(objectId);
    expect(object.classId).toBe(`${issuerId}.twofer-card`);
    expect(object.hexBackgroundColor).toBe("#11181C");
    expect((object.barcode as { value: string }).value).toBe("twofer://redeem/sc/ABC123");
    expect((object.validTimeInterval as { end: { date: string } }).end.date).toBe(content.validUntilIso);
    expect(object.subheader).toBeDefined();
    expect(object.logo).toBeDefined();
  });

  it("no_deal object: no barcode, no expiry, no subheader, still branded", () => {
    const content = buildWalletPassContent({ kind: "no_deal" }, "en");
    const object = buildGoogleWalletGenericObject(content, { issuerId, objectId, logoUrl: null });
    expect(object.barcode).toBeUndefined();
    expect(object.validTimeInterval).toBeUndefined();
    expect(object.subheader).toBeUndefined();
    expect(object.logo).toBeUndefined();
    expect(object.state).toBe("ACTIVE");
  });

  it("save JWT references the pre-inserted object by id only (short URL)", () => {
    const claims = buildGoogleSaveJwtClaims({
      serviceAccountEmail: "sa@project.iam.gserviceaccount.com",
      issuerId,
      objectId,
      iatSeconds: 1_700_000_000,
    });
    expect(claims.aud).toBe("google");
    expect(claims.typ).toBe("savetowallet");
    const payload = claims.payload as { genericObjects: { id: string; classId: string }[] };
    expect(payload.genericObjects).toEqual([{ id: objectId, classId: `${issuerId}.twofer-card` }]);
  });
});
