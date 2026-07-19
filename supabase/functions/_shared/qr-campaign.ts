export const QR_SLUG_RE = /^[a-z0-9][a-z0-9-]{7,63}$/;

export type QrDeviceType =
  | "ios_phone"
  | "android_phone"
  | "android_tablet"
  | "desktop"
  | "bot"
  | "unknown";

export type QrRedirectTargetType = "ios_app_store" | "android_play_store" | "website";

export type QrDestinationType = "app_download" | "website";

export type QrDestinationConfig = {
  iosAppStoreUrl: string | null;
  androidPlayStoreUrl: string | null;
  websiteUrl: string;
};

const BOT_USER_AGENT_RE = /(?:bot|crawler|spider|slurp|preview|facebookexternalhit|slackbot|discordbot|whatsapp|twitterbot|linkedinbot|curl|wget)/i;

export function normalizeQrSlug(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return QR_SLUG_RE.test(normalized) ? normalized : null;
}

export function classifyQrDevice(userAgent: string | null | undefined): QrDeviceType {
  const value = typeof userAgent === "string" ? userAgent.slice(0, 512) : "";
  if (!value) return "unknown";
  if (BOT_USER_AGENT_RE.test(value)) return "bot";
  if (/(?:iPhone|iPod)/i.test(value)) return "ios_phone";
  // Twofer does not ship an iPad app in v1, so iPad scans use the website
  // fallback instead of being treated as an iPhone App Store conversion.
  if (/iPad/i.test(value)) return "unknown";
  if (/Android/i.test(value)) return /Mobile/i.test(value) ? "android_phone" : "android_tablet";
  if (/(?:Windows|Macintosh|Linux|X11|CrOS)/i.test(value)) return "desktop";
  return "unknown";
}

export function isLikelyQrBot(deviceType: QrDeviceType): boolean {
  return deviceType === "bot";
}

function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function resolveQrRedirect(params: {
  destinationType: QrDestinationType;
  deviceType: QrDeviceType;
  config: QrDestinationConfig;
}): { targetType: QrRedirectTargetType; url: string } {
  const websiteUrl = safeHttpsUrl(params.config.websiteUrl) ?? "https://www.twoferapp.com/";
  if (params.destinationType !== "app_download") {
    return { targetType: "website", url: websiteUrl };
  }

  if (params.deviceType === "ios_phone") {
    const url = safeHttpsUrl(params.config.iosAppStoreUrl);
    if (url) return { targetType: "ios_app_store", url };
  }

  if (params.deviceType === "android_phone" || params.deviceType === "android_tablet") {
    const url = safeHttpsUrl(params.config.androidPlayStoreUrl);
    if (url) return { targetType: "android_play_store", url };
  }

  return { targetType: "website", url: websiteUrl };
}

function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// The hash is intentionally day-scoped. It is used only for a short write
// throttle and cannot become a durable cross-day visitor identifier.
export async function dailyQrIpHash(params: {
  ip: string | null;
  secret: string | null;
  now?: Date;
}): Promise<{ hash: string; day: string } | null> {
  if (!params.ip || !params.secret) return null;
  const day = utcDay(params.now ?? new Date());
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(params.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${day}:${params.ip}`),
  );
  return { hash: bytesToHex(new Uint8Array(signature)), day };
}
