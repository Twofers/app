export const TAB_MODE_ASYNC_KEY = "twoforone_tab_mode_v2";

export type CachedTabModeRole = "customer" | "business";

function isCachedTabModeRole(value: unknown): value is CachedTabModeRole {
  return value === "customer" || value === "business";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function encodeCachedRole(userId: string, role: CachedTabModeRole): string {
  return JSON.stringify({ v: 1, userId, role });
}

export function decodeCachedRole(raw: string | null, userId: string): CachedTabModeRole | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (parsed.userId !== userId) return null;
    return isCachedTabModeRole(parsed.role) ? parsed.role : null;
  } catch {
    return null;
  }
}

export function isLegacyCachedRole(raw: string | null): boolean {
  return raw === "customer" || raw === "business";
}
