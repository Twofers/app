import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BrandedConfirmModal } from "@/components/ui/branded-confirm-modal";
import { requestNotificationPermissionsSafe } from "@/lib/expo-notifications-support";
import { getAlertsEnabled, setAlertsEnabled } from "@/lib/notifications";
import { setConsumerNotificationPrefs } from "@/lib/consumer-preferences";
import { PUSH_TOKEN_REGISTRATION_RETRY_MESSAGE, registerPushTokenWithResult } from "@/lib/push-token";
import {
  addBusinessFavorite,
  isBusinessFavorited,
  recordSaveBusinessPromptDismissed,
  shouldShowSaveBusinessPrompt,
  type SaveBusinessPromptContext,
} from "@/lib/save-business-prompt";

type PromptTarget = {
  businessId: string;
  businessName: string | null;
  context: SaveBusinessPromptContext;
};

type PromptStage = null | "save" | "alertsConsent" | "permissionDenied" | "registrationFailed";

/**
 * Return-path prompt: after a claim or redemption, offer to save the business
 * to the existing favorites system, then (only if the user accepts) run the
 * existing consent-gated deal-alert opt-in. Never enables notifications
 * silently — OS permission is requested only after an explicit yes, matching
 * the consumer-home favorite flow.
 */
export function useSaveBusinessPrompt({
  userId,
  onSaved,
}: {
  userId: string | null;
  /** Called after the business is saved so callers can update local favorite state. */
  onSaved?: (businessId: string) => void;
}) {
  const { t } = useTranslation();
  const [stage, setStage] = useState<PromptStage>(null);
  const [target, setTarget] = useState<PromptTarget | null>(null);
  // Ask for alert consent at most once per session (same rule as consumer home).
  const alertsConsentAskedRef = useRef(false);

  const maybePromptSaveBusiness = useCallback(
    async (next: PromptTarget & { alreadyFavorited?: boolean }) => {
      if (!userId || !next.businessId) return;
      if (next.alreadyFavorited) return;
      if (!(await shouldShowSaveBusinessPrompt(next.businessId))) return;
      // Live check so the prompt never shows for an already-saved business
      // (and stays quiet if the check itself fails).
      const favorited = await isBusinessFavorited(userId, next.businessId);
      if (favorited !== false) return;
      setTarget({ businessId: next.businessId, businessName: next.businessName, context: next.context });
      setStage("save");
    },
    [userId],
  );

  // The save dialog closes immediately on confirm; this continues in the background
  // and only re-opens a dialog if the alert-consent step applies.
  const handleSaveConfirmed = useCallback(async () => {
    if (!userId || !target) return;
    const saved = await addBusinessFavorite(userId, target.businessId);
    // Quiet failure: don't stack an error dialog on a nice-to-have prompt.
    if (!saved) return;
    onSaved?.(target.businessId);
    if (alertsConsentAskedRef.current || (await getAlertsEnabled())) return;
    alertsConsentAskedRef.current = true;
    setStage("alertsConsent");
  }, [onSaved, target, userId]);

  const handleSaveDeclined = useCallback(() => {
    if (target) void recordSaveBusinessPromptDismissed(target.businessId);
    setStage(null);
  }, [target]);

  const enableDealAlerts = useCallback(async () => {
    const { status, skippedBecauseExpoGo } = await requestNotificationPermissionsSafe();
    if (skippedBecauseExpoGo || status !== "granted") {
      setStage("permissionDenied");
      return;
    }
    if (userId) {
      const registration = await registerPushTokenWithResult(userId);
      if (!registration.ok) {
        setStage("registrationFailed");
        return;
      }
    }
    await setAlertsEnabled(true);
    await setConsumerNotificationPrefs({ v: 1, mode: "favorites_only" });
    setStage(null);
  }, [userId]);

  const businessLabel = target?.businessName?.trim() || t("dealDetail.localBusiness");
  const saveTitle =
    target?.context === "redeem"
      ? t("returnPrompt.redeemTitle", { defaultValue: "Enjoyed this deal?" })
      : t("returnPrompt.claimTitle", { defaultValue: "Want to see future offers from this business?" });
  const saveBody =
    target?.context === "redeem"
      ? t("returnPrompt.redeemBody", {
          defaultValue: "Save {{business}} to see future offers.",
          business: businessLabel,
        })
      : t("returnPrompt.claimBody", {
          defaultValue: "Save {{business}} to your favorites so their next deals are easy to find.",
          business: businessLabel,
        });

  const saveBusinessPromptElement = (
    <>
      <BrandedConfirmModal
        visible={stage === "save"}
        iconName="favorite"
        title={saveTitle}
        message={saveBody}
        confirmLabel={t("returnPrompt.saveCta", { defaultValue: "Save business" })}
        cancelLabel={t("returnPrompt.notNow", { defaultValue: "Not now" })}
        onConfirm={() => {
          setStage(null);
          void handleSaveConfirmed();
        }}
        onCancel={handleSaveDeclined}
      />
      <BrandedConfirmModal
        visible={stage === "alertsConsent"}
        iconName="notifications-active"
        title={t("consumerHome.alertConsentTitle")}
        message={t("consumerHome.alertConsentBody")}
        confirmLabel={t("consumerHome.alertConsentAccept")}
        cancelLabel={t("consumerHome.alertConsentDecline")}
        onConfirm={() => {
          setStage(null);
          void enableDealAlerts();
        }}
        onCancel={() => setStage(null)}
      />
      <BrandedConfirmModal
        visible={stage === "permissionDenied"}
        iconName="notifications-off"
        title={t("consumerHome.alertsDeniedTitle")}
        message={t("settingsScreen.alertsPermissionBody")}
        confirmLabel={t("commonUi.ok")}
        onConfirm={() => setStage(null)}
      />
      <BrandedConfirmModal
        visible={stage === "registrationFailed"}
        iconName="notifications-off"
        title={t("consumerHome.alertsDeniedTitle")}
        message={t("settingsScreen.alertsRegistrationFailed", {
          defaultValue: PUSH_TOKEN_REGISTRATION_RETRY_MESSAGE,
        })}
        confirmLabel={t("commonUi.ok")}
        onConfirm={() => setStage(null)}
      />
    </>
  );

  return { maybePromptSaveBusiness, saveBusinessPromptElement };
}
