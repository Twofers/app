// Web-attack review 2026-07-31, finding M-3.
//
// PostgREST `.or("col.eq.<value>,other.eq.<value>")` filters use `,` to separate
// disjuncts and `()` to group them. Interpolating a user-controlled value (an
// email whose local part an attacker registered) directly into that string lets
// the value inject an extra disjunct, widening a membership/ownership check.
//
// This strips the PostgREST `or`-grammar metacharacters from an interpolated
// value, mirroring the existing precedent in admin-account-management. Emails do
// not legitimately contain these characters unless RFC 5322 quoting is used,
// which GoTrue rejects, so stripping is safe and prevents the injection.

export function sanitizeOrFilterValue(value: string): string {
  return value.replace(/[,()"]/g, "");
}
