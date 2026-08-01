// Constant-time string comparison for secret checks (cron secrets, tokens).
// Web-attack review 2026-07-31, finding L-3: cron authorization used `===`,
// whose early-exit is a (marginal) timing side channel. This compares in time
// independent of where the first mismatching byte is. Length is not secret here.

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
