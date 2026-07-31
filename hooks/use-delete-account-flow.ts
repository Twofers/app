import { useCallback, useState } from "react";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";

import type { BrandedConfirmOptions } from "@/hooks/use-branded-confirm";
import { clearLocalAuthSessionState } from "@/lib/auth-local-session-state";
import { getDeleteAccountConfirmationCopyKeys } from "@/lib/delete-account-confirmation";
import { deleteUserAccount } from "@/lib/functions";
import { translateKnownApiMessage } from "@/lib/i18n/api-messages";
import { DELETE_ACCOUNT_URL, openWebsiteUrl } from "@/lib/legal-urls";
import { supabase } from "@/lib/supabase";

type DeleteAccountFlowOptions = {
  /** `confirm` from `useBrandedConfirm`. The caller must render its `confirmModal`. */
  confirm: (options: BrandedConfirmOptions) => void;
  /**
   * Whether the account may own business data. Selects the business vs shopper
   * wording in both confirmation steps.
   */
  includesBusinessData: boolean;
  /** Surface a localized failure message (banner, toast, …). */
  onError?: (message: string) => void;
  /** Called around the network call so the caller can disable its own controls. */
  onBusyChange?: (busy: boolean) => void;
};

/**
 * The single in-app account-deletion flow: two branded confirmations, the
 * `delete-user-account` call, a local sign-out, then back to the auth landing.
 *
 * Shared rather than per-screen because it must be reachable from more than one
 * place — the published privacy policy promises deletion "under Account or
 * Settings" and Apple guideline 5.1.1(v) requires an in-app path — while a
 * merchant awaiting approval never reaches the Account tab (every business tab
 * redirects to `/business-setup` until the profile is complete).
 */
export function useDeleteAccountFlow({
  confirm,
  includesBusinessData,
  onError,
  onBusyChange,
}: DeleteAccountFlowOptions): { startDeleteAccount: () => void; deleting: boolean } {
  const { t } = useTranslation();
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  const runDeleteAccount = useCallback(async () => {
    setDeleting(true);
    onBusyChange?.(true);
    try {
      await deleteUserAccount();
      await supabase.auth.signOut({ scope: "local" });
      await clearLocalAuthSessionState();
      router.replace("/auth-landing" as Href);
    } catch (e: unknown) {
      // Don't surface raw Postgres / RLS / network errors during a sensitive
      // flow. Pass through translateKnownApiMessage so technical messages get a
      // localized friendly equivalent; fall back to the generic copy.
      const raw = e instanceof Error ? e.message : "";
      onError?.(raw ? translateKnownApiMessage(raw, t) : t("deleteAccount.errFailed"));
      confirm({
        iconName: "error-outline",
        title: t("deleteAccount.errFailed"),
        message: t("deleteAccount.fallbackWebBody"),
        confirmLabel: t("deleteAccount.openWebsiteFallbackCta"),
        onConfirm: () => void openWebsiteUrl(DELETE_ACCOUNT_URL),
        cancelLabel: t("deleteAccount.alertDismiss"),
      });
    } finally {
      setDeleting(false);
      onBusyChange?.(false);
    }
  }, [confirm, onBusyChange, onError, router, t]);

  const confirmFinalDeleteAccount = useCallback(
    (finalBodyKey: string) => {
      confirm({
        iconName: "delete-forever",
        title: t("deleteAccount.finalTitle"),
        message: t(finalBodyKey),
        confirmLabel: t("deleteAccount.finalConfirmDestructive"),
        onConfirm: () => void runDeleteAccount(),
        cancelLabel: t("deleteAccount.keepAccount"),
      });
    },
    [confirm, runDeleteAccount, t],
  );

  const startDeleteAccount = useCallback(() => {
    const copyKeys = getDeleteAccountConfirmationCopyKeys(includesBusinessData);
    confirm({
      iconName: "delete-forever",
      title: t("deleteAccount.title"),
      message: t(copyKeys.impactBodyKey),
      confirmLabel: t("deleteAccount.reviewImpactCta"),
      onConfirm: () => confirmFinalDeleteAccount(copyKeys.finalBodyKey),
      cancelLabel: t("commonUi.cancel"),
    });
  }, [confirm, confirmFinalDeleteAccount, includesBusinessData, t]);

  return { startDeleteAccount, deleting };
}
