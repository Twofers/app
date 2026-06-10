const PIN_HASH_PREFIX = "pbkdf2_sha256";
const PIN_HASH_ITERATIONS = 120_000;
const PIN_HASH_BYTES = 32;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const max = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < max; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

export function normalizePin(pin: unknown): string | null {
  if (typeof pin !== "string") return null;
  const trimmed = pin.trim();
  if (!/^\d{4,6}$/.test(trimmed)) return null;
  return trimmed;
}

export function randomBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function hashExitToken(token: string): Promise<string> {
  return `sha256$${await sha256Base64Url(token)}`;
}

export async function verifyExitToken(token: string, storedHash: string): Promise<boolean> {
  if (!storedHash.startsWith("sha256$")) return false;
  return constantTimeEqual(await hashExitToken(token), storedHash);
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBase64Url(16);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: bytesToArrayBuffer(base64UrlToBytes(salt)),
      iterations: PIN_HASH_ITERATIONS,
    },
    keyMaterial,
    PIN_HASH_BYTES * 8,
  );
  return `${PIN_HASH_PREFIX}$${PIN_HASH_ITERATIONS}$${salt}$${bytesToBase64Url(new Uint8Array(bits))}`;
}

export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  const [prefix, iterationsRaw, salt, expected] = storedHash.split("$");
  const iterations = Number(iterationsRaw);
  if (prefix !== PIN_HASH_PREFIX || !Number.isFinite(iterations) || !salt || !expected) return false;
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: bytesToArrayBuffer(base64UrlToBytes(salt)),
      iterations,
    },
    keyMaterial,
    PIN_HASH_BYTES * 8,
  );
  const actual = `${PIN_HASH_PREFIX}$${iterations}$${salt}$${bytesToBase64Url(new Uint8Array(bits))}`;
  return constantTimeEqual(actual, storedHash);
}
