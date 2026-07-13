// Trusted client-IP derivation for public (verify_jwt=false) Edge Functions.
//
// The old `firstForwardedIp` helper trusted the LEFTMOST x-forwarded-for hop,
// which is attacker-controlled: a client can inject any x-forwarded-for value
// and the platform appends the real IP to the right. Using that spoofable value
// as a rate-limit key lets an attacker rotate it per request to evade the cap,
// and lets arbitrary text be stored as an `ip_address` audit value.
//
// This module (1) prefers edge/CDN headers the client cannot append to,
// (2) otherwise takes the RIGHTMOST syntactically valid x-forwarded-for entry,
// and (3) validates the result as a real IP so arbitrary text is never used as a
// key or stored. A determined attacker can still rotate *valid* IPs; callers must
// pair this with a client-independent cap (a global window ceiling) as a backstop.
//
// Dependency-free on purpose (only Web `Request`/`Headers`) so it is unit-testable
// under Node/vitest as well as usable from Deno.

// Longest possible IPv6 textual form (e.g. an IPv4-mapped address with zone id).
export const MAX_IP_LENGTH = 45;

// Edge/CDN headers, in preference order, that trusted infrastructure sets to the
// real client IP and that a client cannot append to (unlike x-forwarded-for).
const TRUSTED_IP_HEADERS = ["cf-connecting-ip", "x-real-ip", "fly-client-ip"] as const;

export function isLikelyIpAddress(value: string): boolean {
  if (!value || value.length > MAX_IP_LENGTH) return false;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    return value.split(".").every((octet) => Number(octet) <= 255);
  }
  // Loose IPv6 (incl. IPv4-mapped like ::ffff:1.2.3.4): hex/colon groups with an
  // optional embedded IPv4 tail and optional zone id.
  return value.includes(":") && /^[0-9a-f:.]+(?:%[0-9a-z._-]+)?$/i.test(value);
}

export function clientIpFromRequest(req: Request): string | null {
  for (const header of TRUSTED_IP_HEADERS) {
    const value = req.headers.get(header)?.trim();
    if (value && isLikelyIpAddress(value)) return value;
  }
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((hop) => hop.trim()).filter(Boolean);
    for (let i = hops.length - 1; i >= 0; i--) {
      if (isLikelyIpAddress(hops[i])) return hops[i];
    }
  }
  return null;
}
