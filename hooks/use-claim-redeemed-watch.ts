import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { supabase } from "@/lib/supabase";
import { classifyClaimWatchRow, type ClaimWatchEndKind } from "@/lib/claim-watch";

type UseClaimRedeemedWatchOpts = {
  /** Claim to watch, or null to watch nothing. */
  claimId: string | null;
  /** Only poll while true (e.g. the QR modal is on screen). */
  enabled: boolean;
  /** Poll cadence in ms. Defaults to 3000. */
  intervalMs?: number;
  /** Fired once when the claim is redeemed (counter QR scan or in-app pass). */
  onRedeemed: (info: { claimId: string }) => void;
  /** Fired once when the claim ends without a redemption. */
  onEnded?: (info: { claimId: string; kind: Exclude<ClaimWatchEndKind, "redeemed"> }) => void;
};

/**
 * Polls a single deal_claim while `enabled` so the customer's open QR view can react the
 * moment staff scans it — the QR disappears and the deal flips to redeemed without waiting
 * for a manual pull-to-refresh.
 *
 * Why polling and not Realtime: the supabase_realtime publication is INSERT-only in this
 * project (migration 20260705120006) to avoid leaking merchant UPDATEs, so redemption
 * UPDATEs are never broadcast. Polling the customer's own claim (which RLS already allows)
 * is the least-privileged way to notice the change.
 *
 * Best-effort: read errors are swallowed and retried on the next tick; focus and
 * pull-to-refresh remain the backstop. `onRedeemed`/`onEnded` fire at most once per mount.
 */
export function useClaimRedeemedWatch({
  claimId,
  enabled,
  intervalMs = 3000,
  onRedeemed,
  onEnded,
}: UseClaimRedeemedWatchOpts): void {
  const onRedeemedRef = useRef(onRedeemed);
  onRedeemedRef.current = onRedeemed;
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  useEffect(() => {
    if (!enabled || !claimId) return;

    let cancelled = false;
    let fired = false;

    const poll = async () => {
      if (cancelled || fired) return;
      const { data, error } = await supabase
        .from("deal_claims")
        .select("id,redeemed_at,claim_status")
        .eq("id", claimId)
        .maybeSingle();
      if (cancelled || fired || error) return;
      const result = classifyClaimWatchRow(data as { redeemed_at?: string | null; claim_status?: string | null } | null);
      if (!result.done) return;
      fired = true;
      if (result.kind === "redeemed") {
        onRedeemedRef.current({ claimId });
      } else {
        onEndedRef.current?.({ claimId, kind: result.kind });
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), intervalMs);
    // Re-check immediately when the app returns to the foreground — timers are throttled
    // while backgrounded, so a scan that happened during a lock/switch surfaces at once.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void poll();
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      sub.remove();
    };
  }, [claimId, enabled, intervalMs]);
}
