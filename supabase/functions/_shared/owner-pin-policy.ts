/**
 * Owner Redeem-tab PIN rotation policy (audit Finding 2).
 *
 * `enable` originally overwrote an existing pin_hash without proving knowledge
 * of the current PIN, which let anyone holding the owner's signed-in device
 * rotate the gate PIN and clear its lockout. Rule: whenever a pin_hash already
 * exists for the business, setting a PIN requires the current PIN first.
 *
 * Kept as a pure module so the decision is unit-testable under vitest
 * (the function entrypoints are Deno-only).
 */
export function pinRotationRequiresCurrentPin(
  row: { pin_hash?: string | null } | null | undefined,
): boolean {
  return typeof row?.pin_hash === "string" && row.pin_hash.length > 0;
}
