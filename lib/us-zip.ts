/** Normalize user input: trim and remove internal spaces (e.g. "75 063" → "75063"). */
export function normalizeUsZipInput(raw: string): string {
  return raw.trim().replace(/\s+/g, "");
}

export const US_ZIP_MAX_LENGTH = 5;

/** Keep only five ZIP digits while typing. */
export function sanitizeUsZipInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, US_ZIP_MAX_LENGTH);
}

/** True for a 5-digit US ZIP. ZIP+4 is not accepted in v1. */
export function isValidUsZipFormat(normalized: string): boolean {
  return /^\d{5}$/.test(normalized);
}

/** Returns the 5-digit ZIP prefix when `normalized` is valid; otherwise null. */
export function parseUsZipFiveDigits(normalized: string): string | null {
  const m = normalized.match(/^(\d{5})$/);
  return m ? m[1]! : null;
}
