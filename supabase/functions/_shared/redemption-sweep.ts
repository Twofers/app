/**
 * Staff-device sweep for owner account deletion (audit Finding 6, batch R5).
 *
 * Staff Auth users are separate auth.users rows that no FK cascade removes
 * when the owner account is deleted; their refresh tokens must die with the
 * account. delete-user-account collects the owner's redemption_devices rows
 * and admin-deletes each linked staff user before deleting the owner.
 *
 * Pure module so the selection logic is unit-testable under vitest.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function staffUserIdsToSweep(
  rows: Array<{ staff_user_id?: string | null }> | null | undefined,
  ownerId: string,
): string[] {
  const ids = new Set<string>();
  for (const row of rows ?? []) {
    const id = row?.staff_user_id;
    if (typeof id !== "string" || !UUID_RE.test(id)) continue;
    // Never the owner's own id: the owner delete is the caller's last step.
    if (id === ownerId) continue;
    ids.add(id);
  }
  return [...ids];
}
