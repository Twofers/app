/** Normalize user input: trim and remove internal spaces (e.g. "75 063" → "75063"). */
export function normalizeUsZipInput(raw: string): string {
  return raw.trim().replace(/\s+/g, "");
}

/** True for 5-digit US ZIP or ZIP+4 (e.g. 75063, 75063-1234). */
export function isValidUsZipFormat(normalized: string): boolean {
  return /^\d{5}(?:-\d{4})?$/.test(normalized);
}

/** Returns the 5-digit ZIP prefix when `normalized` is valid; otherwise null. */
export function parseUsZipFiveDigits(normalized: string): string | null {
  const m = normalized.match(/^(\d{5})(?:-\d{4})?$/);
  return m ? m[1]! : null;
}
