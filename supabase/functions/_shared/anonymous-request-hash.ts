import { clientIpFromRequest } from "./client-ip.ts";

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function anonymousRequestActorHash(req: Request): Promise<string | null> {
  const ip = clientIpFromRequest(req) || "unknown";
  return anonymousAbuseKeyHash("ip", ip);
}

export async function anonymousAbuseKeyHash(
  scope: string,
  value: string,
): Promise<string | null> {
  const secret = (Deno.env.get("ANON_ABUSE_IP_HASH_SECRET") ?? "").trim();
  if (secret.length < 32) return null;
  const day = new Date().toISOString().slice(0, 10);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${scope}:${day}:${value}`),
  );
  return hex(signature);
}
