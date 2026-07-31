const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function founderAdminUserId(): string | null {
  const configured = (Deno.env.get("FOUNDER_ADMIN_USER_ID") ?? "").trim().toLowerCase();
  return UUID_RE.test(configured) ? configured : null;
}

export function isFounderAdminUser(userId: string, role: unknown): boolean {
  const founderId = founderAdminUserId();
  return Boolean(founderId && userId.toLowerCase() === founderId && role === "owner");
}
