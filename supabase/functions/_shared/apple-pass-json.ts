/**
 * Native wallet pass ("Twofer Card") — Apple pass.json builder.
 * Maps the platform-neutral WalletPassContent (from wallet-pass-content.ts)
 * into an Apple PassKit `pass.json` for a generic pass. Pure (no Deno imports),
 * so it is exercised directly by the vitest suite. Deal facts come straight
 * from the content model and are never altered here.
 */

import {
  WALLET_PASS_APP_URL,
  WALLET_PASS_BACKGROUND_HEX,
  WALLET_PASS_FOREGROUND_HEX,
  WALLET_PASS_LABEL_HEX,
  WALLET_PASS_SUPPORT_EMAIL,
  type WalletPassContent,
} from "./wallet-pass-content.ts";

/** "#11181C" -> "rgb(17, 24, 28)" (Apple wants rgb() strings). */
export function hexToRgbString(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

const LOCALE_LANG: Record<string, string> = { en: "en", es: "es", ko: "ko" };

export type ApplePassJsonOptions = {
  serialNumber: string;
  passTypeId: string;
  teamId: string;
  /** Optional PassKit web service (part 2 — auto-updates). Omit for a static pass. */
  webServiceURL?: string | null;
  authenticationToken?: string | null;
};

export function buildApplePassJson(
  content: WalletPassContent,
  opts: ApplePassJsonOptions,
): Record<string, unknown> {
  const primaryFields = [
    {
      key: "header",
      ...(content.headerLabel ? { label: content.headerLabel } : {}),
      value: content.header,
    },
  ];

  // Business + redeem-by become secondary fields; the code row is intentionally
  // dropped because the barcode already prints it as altText.
  const secondaryFields = content.rows
    .filter((row) => row.id === "business" || row.id === "redeem_by" || row.id === "message")
    .map((row) => ({ key: row.id, label: row.label, value: row.value }));

  const backFields = content.links.map((link, idx) => ({
    key: `link_${idx}`,
    label: link.label,
    value: link.uri,
  }));

  const pass: Record<string, unknown> = {
    formatVersion: 1,
    passTypeIdentifier: opts.passTypeId,
    teamIdentifier: opts.teamId,
    organizationName: content.cardTitle,
    description: `${content.cardTitle} — ${content.header}`,
    serialNumber: opts.serialNumber,
    logoText: content.cardTitle,
    backgroundColor: hexToRgbString(WALLET_PASS_BACKGROUND_HEX),
    foregroundColor: hexToRgbString(WALLET_PASS_FOREGROUND_HEX),
    labelColor: hexToRgbString(WALLET_PASS_LABEL_HEX),
    sharingProhibited: true,
    generic: {
      primaryFields,
      secondaryFields,
      auxiliaryFields: [],
      backFields,
    },
  };

  if (content.barcode) {
    const barcode = {
      format: "PKBarcodeFormatQR",
      message: content.barcode.value,
      messageEncoding: "iso-8859-1",
      altText: content.barcode.alternateText,
    };
    // `barcodes` is the modern array; `barcode` is the legacy single for old iOS.
    pass.barcodes = [barcode];
    pass.barcode = barcode;
  }

  if (content.validUntilIso) {
    pass.expirationDate = content.validUntilIso;
    pass.relevantDate = content.validUntilIso;
  }

  if (typeof content.latitude === "number" && typeof content.longitude === "number") {
    pass.locations = [{ latitude: content.latitude, longitude: content.longitude }];
  }

  const lang = LOCALE_LANG[content.locale] ?? "en";
  if (lang) pass.lang = lang; // informational; real localization would use .lproj folders

  if (opts.webServiceURL && opts.authenticationToken) {
    pass.webServiceURL = opts.webServiceURL;
    pass.authenticationToken = opts.authenticationToken;
  }

  // Keep support/app URLs discoverable even when links are also on the back.
  void WALLET_PASS_APP_URL;
  void WALLET_PASS_SUPPORT_EMAIL;

  return pass;
}
