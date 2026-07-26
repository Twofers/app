import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BrandedConfirmOptions } from "@/hooks/use-branded-confirm";
import { manualRedeemClaim } from "@/lib/manual-redeem";
import { translateKnownApiMessage } from "@/lib/i18n/api-messages";
import { trackAppAnalyticsEvent } from "@/lib/app-analytics";

/** Max gap between the two taps, in ms. Matches the platform double-tap feel. */
const DOUBLE_TAP_MS = 300;

type ConfirmFn = (options: BrandedConfirmOptions) => void;

/**
 * "Staff can't scan it" fallback: double-tap the QR to mark the deal used.
 *
 * Deliberately has no time gate — no delayed reveal, no countdown (Dan,
 * 2026-07-25). The single guardrail is the branded confirm, which exists so a
 * fumbled double-tap can't burn a claim; it is not a trust control. See
 * `lib/manual-redeem.ts` for the accepted trust trade-off.
 *
 * Shared by both QR surfaces (the Use Deal pass and the post-claim QR modal) so
 * the gesture, copy, and error handling can't drift between them. The caller
 * supplies `confirm` from its own `useBrandedConfirm` so each screen keeps
 * rendering exactly one confirm modal.
 */
export function useManualQrRedeem(params: {
  claimId: string | null;
  confirm: ConfirmFn;
  onRedeemed?: () => void;
  /** Analytics context so we can tell the two surfaces apart. */
  surface: string;
  dealId?: string | null;
  businessId?: string | null;
}) {
  const { claimId, confirm, onRedeemed, surface, dealId, businessId } = params;
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastTapMsRef = useRef(0);
  const busyRef = useRef(false);

  const runRedeem = useCallback(async () => {
    if (!claimId || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      trackAppAnalyticsEvent({
        event_name: "redeem_started",
        claim_id: claimId,
        deal_id: dealId ?? null,
        business_id: businessId ?? null,
        context: { method: "manual_double_tap", phase: "confirmed", surface },
      });
      await manualRedeemClaim(claimId);
      onRedeemed?.();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "";
      setError(raw ? translateKnownApiMessage(raw, t) : t("apiErrors.operationFailedTryAgain"));
      trackAppAnalyticsEvent({
        event_name: "redeem_failed",
        claim_id: claimId,
        deal_id: dealId ?? null,
        business_id: businessId ?? null,
        context: { method: "manual_double_tap", surface },
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [claimId, dealId, businessId, surface, onRedeemed, t]);

  /** Attach to the QR wrapper's onPress; fires only on the second quick tap. */
  const handleQrPress = useCallback(() => {
    if (!claimId || busyRef.current) return;
    const now = Date.now();
    const isDoubleTap = now - lastTapMsRef.current <= DOUBLE_TAP_MS;
    lastTapMsRef.current = isDoubleTap ? 0 : now;
    if (!isDoubleTap) return;

    setError(null);
    confirm({
      iconName: "check-circle",
      title: t("consumerWallet.manualRedeemConfirmTitle"),
      message: t("consumerWallet.manualRedeemConfirmBody"),
      confirmLabel: t("consumerWallet.manualRedeemConfirmCta"),
      onConfirm: () => void runRedeem(),
      cancelLabel: t("commonUi.cancel"),
    });
  }, [claimId, confirm, runRedeem, t]);

  return {
    handleQrPress,
    busy,
    error,
    /** Always-visible instruction. No delay — the fallback is discoverable up front. */
    hintLabel: t("consumerWallet.manualRedeemHint"),
    /** Screen-reader equivalent for a gesture VoiceOver/TalkBack can't perform. */
    accessibilityProps: {
      accessibilityRole: "button" as const,
      accessibilityLabel: t("consumerWallet.manualRedeemHint"),
      accessibilityActions: [
        { name: "activate" as const, label: t("consumerWallet.manualRedeemConfirmCta") },
      ],
      onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => {
        if (event.nativeEvent.actionName !== "activate" || !claimId || busyRef.current) return;
        setError(null);
        confirm({
          iconName: "check-circle",
          title: t("consumerWallet.manualRedeemConfirmTitle"),
          message: t("consumerWallet.manualRedeemConfirmBody"),
          confirmLabel: t("consumerWallet.manualRedeemConfirmCta"),
          onConfirm: () => void runRedeem(),
          cancelLabel: t("commonUi.cancel"),
        });
      },
    },
  };
}
