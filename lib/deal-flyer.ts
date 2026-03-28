import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import QRCode from "qrcode";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DealFlyerInput = {
  dealId: string;
  title: string;
  description: string | null;
  posterUri: string | null;
  businessName: string;
  /** Translated strings injected from the call-site so the flyer respects the merchant's locale. */
  strings: {
    scanAtCounter: string;
    openInApp: string;
    poweredBy: string;
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SCHEME_PREFIX = "twoforone://deal/";

const DEAL_LINK_BASE = process.env.EXPO_PUBLIC_SUPABASE_URL
  ? `${process.env.EXPO_PUBLIC_SUPABASE_URL.replace(/\/$/, "")}/functions/v1/deal-link`
  : null;

function buildQrPayload(dealId: string): string {
  if (DEAL_LINK_BASE) return `${DEAL_LINK_BASE}?id=${encodeURIComponent(dealId)}`;
  return `${SCHEME_PREFIX}${dealId}`;
}

async function generateQrSvg(data: string): Promise<string> {
  return QRCode.toString(data, {
    type: "svg",
    margin: 1,
    width: 200,
    color: { dark: "#11181C", light: "#FFFFFF" },
  });
}

// ---------------------------------------------------------------------------
// HTML template
// ---------------------------------------------------------------------------

function buildFlyerHtml(input: DealFlyerInput, qrSvg: string): string {
  const deepLink = `${SCHEME_PREFIX}${input.dealId}`;

  const posterBlock = input.posterUri
    ? `<img src="${esc(input.posterUri)}" class="poster" />`
    : "";

  const descBlock = input.description
    ? `<p class="desc">${esc(input.description)}</p>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; background: #fff; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    display: flex; align-items: center; justify-content: center;
    padding: 32px;
  }
  .card {
    width: 100%; max-width: 520px;
    border: 3px solid #FF9F1C;
    border-radius: 24px;
    overflow: hidden;
    background: #fff;
  }
  .brand-bar {
    background: #FF9F1C;
    padding: 14px 24px;
    text-align: center;
  }
  .brand-bar span {
    font-size: 26px; font-weight: 900;
    color: #fff; letter-spacing: 3px;
  }
  .poster {
    width: 100%; max-height: 320px;
    object-fit: cover; display: block;
  }
  .body { padding: 28px 24px; text-align: center; }
  .title {
    font-size: 26px; font-weight: 800;
    color: #11181C; line-height: 1.2;
    margin-bottom: 12px;
  }
  .desc {
    font-size: 15px; color: #444;
    line-height: 1.55; white-space: pre-wrap;
    margin-bottom: 20px;
  }
  .divider {
    width: 48px; height: 3px;
    background: #FF9F1C; border-radius: 2px;
    margin: 0 auto 24px;
  }
  .qr-wrap { margin: 0 auto 14px; width: 200px; }
  .qr-wrap svg { display: block; }
  .scan-label {
    font-size: 20px; font-weight: 800;
    color: #11181C; margin-bottom: 4px;
  }
  .scan-sub {
    font-size: 13px; color: #777;
    margin-bottom: 6px;
  }
  .deep-link {
    font-size: 10px; color: #aaa;
    word-break: break-all;
  }
  .footer {
    padding: 10px 24px 14px;
    text-align: center;
    border-top: 1px solid #eee;
  }
  .footer span {
    font-size: 11px; color: #bbb;
    font-weight: 600; letter-spacing: 0.5px;
  }
  .biz-name {
    font-size: 13px; font-weight: 700;
    color: #888; margin-bottom: 16px;
  }
</style>
</head>
<body>
<div class="card">
  <div class="brand-bar"><span>TWOFER</span></div>
  ${posterBlock}
  <div class="body">
    <p class="biz-name">${esc(input.businessName)}</p>
    <h1 class="title">${esc(input.title)}</h1>
    ${descBlock}
    <div class="divider"></div>
    <div class="qr-wrap">${qrSvg}</div>
    <p class="scan-label">${esc(input.strings.scanAtCounter)}</p>
    <p class="scan-sub">${esc(input.strings.openInApp)}</p>
    <p class="deep-link">${esc(deepLink)}</p>
  </div>
  <div class="footer"><span>${esc(input.strings.poweredBy)}</span></div>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates a print-ready PDF flyer for a deal and opens the system share sheet.
 * Returns the local file URI of the generated PDF.
 */
export async function printDealFlyer(input: DealFlyerInput): Promise<string> {
  const qrSvg = await generateQrSvg(buildQrPayload(input.dealId));
  const html = buildFlyerHtml(input, qrSvg);
  const { uri } = await Print.printToFileAsync({ html, width: 612, height: 792 });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
  }

  return uri;
}
