import { describe, expect, it } from "vitest";
import { buildWalletPassContent, deriveWalletPassState, type WalletPassClaimRow } from "./wallet-pass-content.ts";
import { buildApplePassJson, hexToRgbString } from "./apple-pass-json.ts";

const NOW = Date.UTC(2026, 6, 11, 18, 0, 0);
const HOUR = 3_600_000;

function activeContent(locale: "en" | "es" | "ko" = "en") {
  const row: WalletPassClaimRow = {
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
  };
  return buildWalletPassContent(deriveWalletPassState([row], NOW, locale), locale);
}

const OPTS = { serialNumber: "serial-1", passTypeId: "pass.com.unvmex2.twoforone", teamId: "L9DT756YSN" };

describe("hexToRgbString", () => {
  it("maps the brand hexes to rgb() strings", () => {
    expect(hexToRgbString("#11181C")).toBe("rgb(17, 24, 28)");
    expect(hexToRgbString("#FF9F1C")).toBe("rgb(255, 159, 28)");
    expect(hexToRgbString("#FFFFFF")).toBe("rgb(255, 255, 255)");
  });
});

describe("buildApplePassJson — active deal", () => {
  const pass = buildApplePassJson(activeContent(), OPTS);

  it("carries the required pass identity fields", () => {
    expect(pass.formatVersion).toBe(1);
    expect(pass.passTypeIdentifier).toBe("pass.com.unvmex2.twoforone");
    expect(pass.teamIdentifier).toBe("L9DT756YSN");
    expect(pass.serialNumber).toBe("serial-1");
    expect(pass.organizationName).toBe("Twofer");
  });

  it("uses the brand colors", () => {
    expect(pass.backgroundColor).toBe("rgb(17, 24, 28)");
    expect(pass.foregroundColor).toBe("rgb(255, 255, 255)");
    expect(pass.labelColor).toBe("rgb(255, 159, 28)");
  });

  it("emits a QR barcode carrying the sc scheme with the code as altText", () => {
    const barcodes = pass.barcodes as { format: string; message: string; altText: string }[];
    expect(barcodes[0].format).toBe("PKBarcodeFormatQR");
    expect(barcodes[0].message).toBe("twofer://redeem/sc/ABC123");
    expect(barcodes[0].altText).toBe("ABC 123");
    // legacy single barcode present too for old iOS
    expect((pass.barcode as { message: string }).message).toBe("twofer://redeem/sc/ABC123");
  });

  it("sets expiration, relevance, and lock-screen location", () => {
    expect(typeof pass.expirationDate).toBe("string");
    expect(pass.relevantDate).toBe(pass.expirationDate);
    expect(pass.locations).toEqual([{ latitude: 32.78, longitude: -96.8 }]);
  });

  it("maps content into primary/secondary/back fields", () => {
    const g = pass.generic as {
      primaryFields: { label?: string; value: string }[];
      secondaryFields: { key: string; value: string }[];
      backFields: { value: string }[];
    };
    expect(g.primaryFields[0].value).toBe("Buy one latte, get one free");
    expect(g.secondaryFields.map((f) => f.key)).toContain("business");
    expect(g.secondaryFields.map((f) => f.key)).toContain("redeem_by");
    // the code row is NOT duplicated as a field (barcode altText covers it)
    expect(g.secondaryFields.map((f) => f.key)).not.toContain("code");
    expect(g.backFields.length).toBeGreaterThan(0);
  });

  it("is a static pass by default (no webServiceURL)", () => {
    expect(pass.webServiceURL).toBeUndefined();
    expect(pass.authenticationToken).toBeUndefined();
  });

  it("includes webServiceURL only when both url and token are supplied", () => {
    const updating = buildApplePassJson(activeContent(), {
      ...OPTS,
      webServiceURL: "https://x.supabase.co/functions/v1/wallet-pass-webservice",
      authenticationToken: "tok",
    });
    expect(updating.webServiceURL).toBe("https://x.supabase.co/functions/v1/wallet-pass-webservice");
    expect(updating.authenticationToken).toBe("tok");
  });
});

describe("buildApplePassJson — no active deal", () => {
  const pass = buildApplePassJson(buildWalletPassContent({ kind: "no_deal" }, "en"), OPTS);

  it("has no barcode, expiration, or location", () => {
    expect(pass.barcodes).toBeUndefined();
    expect(pass.barcode).toBeUndefined();
    expect(pass.expirationDate).toBeUndefined();
    expect(pass.locations).toBeUndefined();
  });

  it("shows the no-deal headline", () => {
    const g = pass.generic as { primaryFields: { value: string }[] };
    expect(g.primaryFields[0].value).toBe("No active deal");
  });
});
