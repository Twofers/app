/**
 * Countdown label selection for consumer deal cards.
 *
 * Kept as a pure function (i18n key + params, no `t`) so the tier boundaries are
 * unit-testable. The day tier exists because long-dated deals previously rendered
 * as raw hours — a six-week deal showed "1022h 33m left", which reads as noise
 * rather than urgency.
 */
export type DealCountdownLabel = {
  key: "consumerHome.timeLeftDH" | "consumerHome.timeLeftD" | "consumerHome.timeLeftHM" | "consumerHome.timeLeftM";
  params: { d?: number; h?: number; m?: number };
};

/** Returns null when the deal has already ended (caller renders an "expired" label). */
export function dealCountdownLabel(deltaMs: number): DealCountdownLabel | null {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return null;

  // Never round down to "0m left" while the deal is still claimable.
  const totalMin = Math.max(1, Math.floor(deltaMs / 60_000));
  const totalHours = Math.floor(totalMin / 60);

  if (totalHours >= 24) {
    const d = Math.floor(totalHours / 24);
    const h = totalHours % 24;
    return h > 0
      ? { key: "consumerHome.timeLeftDH", params: { d, h } }
      : { key: "consumerHome.timeLeftD", params: { d } };
  }
  if (totalHours > 0) {
    return { key: "consumerHome.timeLeftHM", params: { h: totalHours, m: totalMin % 60 } };
  }
  return { key: "consumerHome.timeLeftM", params: { m: totalMin } };
}
