export type WebsiteImportUrlError =
  | "EMPTY_URL"
  | "URL_TOO_LONG"
  | "INVALID_URL"
  | "UNSUPPORTED_PROTOCOL"
  | "CREDENTIALS_NOT_ALLOWED"
  | "UNSUPPORTED_PORT"
  | "LOCAL_HOST_BLOCKED"
  | "PRIVATE_IP_BLOCKED";

export type WebsiteImportUrlResult =
  | {
      ok: true;
      url: string;
      origin: string;
      hostname: string;
    }
  | {
      ok: false;
      reason: WebsiteImportUrlError;
    };

const MAX_WEBSITE_URL_LENGTH = 2048;
const BLOCKED_LOCAL_HOSTS = new Set(["localhost", "localhost.localdomain"]);

function withDefaultScheme(value: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
}

function cleanHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

function parseIpv4(hostname: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;
  const parts = hostname.split(".").map((part) => Number(part));
  return parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}

function isBlockedIpv4(parts: number[]): boolean {
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedIpv6(hostname: string): boolean {
  if (!hostname.includes(":")) return false;
  const compact = hostname.toLowerCase();
  const dottedMappedIpv4 = compact.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dottedMappedIpv4) {
    const ipv4 = parseIpv4(dottedMappedIpv4[1]);
    return ipv4 ? isBlockedIpv4(ipv4) : true;
  }
  const hexMappedIpv4 = compact.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMappedIpv4) {
    const high = Number.parseInt(hexMappedIpv4[1], 16);
    const low = Number.parseInt(hexMappedIpv4[2], 16);
    return isBlockedIpv4([high >> 8, high & 255, low >> 8, low & 255]);
  }
  if (compact === "::" || compact === "::1") return true;
  if (compact.startsWith("fc") || compact.startsWith("fd")) return true;
  if (compact.startsWith("fe80:")) return true;
  if (compact.startsWith("2001:db8:")) return true;
  return false;
}

function isBlockedLocalHostname(hostname: string): boolean {
  return (
    BLOCKED_LOCAL_HOSTS.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".home.arpa")
  );
}

export function validateWebsiteImportUrl(rawValue: string): WebsiteImportUrlResult {
  const trimmed = rawValue.trim();
  if (!trimmed) return { ok: false, reason: "EMPTY_URL" };
  if (trimmed.length > MAX_WEBSITE_URL_LENGTH) return { ok: false, reason: "URL_TOO_LONG" };

  let parsed: URL;
  try {
    parsed = new URL(withDefaultScheme(trimmed));
  } catch {
    return { ok: false, reason: "INVALID_URL" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "UNSUPPORTED_PROTOCOL" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "CREDENTIALS_NOT_ALLOWED" };
  }
  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
    return { ok: false, reason: "UNSUPPORTED_PORT" };
  }

  parsed.hash = "";
  const hostname = cleanHostname(parsed.hostname);
  if (!hostname) return { ok: false, reason: "INVALID_URL" };
  if (isBlockedLocalHostname(hostname)) return { ok: false, reason: "LOCAL_HOST_BLOCKED" };

  const ipv4 = parseIpv4(hostname);
  if ((ipv4 && isBlockedIpv4(ipv4)) || isBlockedIpv6(hostname)) {
    return { ok: false, reason: "PRIVATE_IP_BLOCKED" };
  }

  return {
    ok: true,
    url: parsed.toString(),
    origin: parsed.origin,
    hostname,
  };
}
