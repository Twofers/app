export type DealDetailActionState =
  | { kind: "claimable"; showClaim: true; claimDisabled: false; showQr: false; statusLabel: null }
  | { kind: "claiming"; showClaim: true; claimDisabled: true; showQr: false; statusLabel: null }
  | { kind: "active_claimed"; showClaim: false; claimDisabled: true; showQr: true; statusLabel: null }
  | { kind: "unavailable"; showClaim: false; claimDisabled: true; showQr: false; statusLabel: string };

export function getDealDetailActionState({
  hasActiveClaim,
  isClaiming,
  unavailableLabel,
}: {
  hasActiveClaim: boolean;
  isClaiming: boolean;
  unavailableLabel: string | null;
}): DealDetailActionState {
  if (hasActiveClaim) {
    return {
      kind: "active_claimed",
      showClaim: false,
      claimDisabled: true,
      showQr: true,
      statusLabel: null,
    };
  }

  if (isClaiming) {
    return {
      kind: "claiming",
      showClaim: true,
      claimDisabled: true,
      showQr: false,
      statusLabel: null,
    };
  }

  if (unavailableLabel) {
    return {
      kind: "unavailable",
      showClaim: false,
      claimDisabled: true,
      showQr: false,
      statusLabel: unavailableLabel,
    };
  }

  return {
    kind: "claimable",
    showClaim: true,
    claimDisabled: false,
    showQr: false,
    statusLabel: null,
  };
}
