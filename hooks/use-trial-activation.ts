import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { createTrialCheckoutUrl, nativeCheckoutSource } from "@/lib/billing-activation";
import { openWebsiteUrl } from "@/lib/legal-urls";

/**
 * Shared "activate my approved trial" action for the merchant surfaces that
 * used to open the static /business/billing/start page.
 *
 * That page can only tell an owner to go find the single-use activation link in
 * their approval email — the app cannot reconstruct that emailed token. But
 * stripe-create-checkout-session also accepts an authenticated owner with no
 * token, so a signed-in owner can mint their own Stripe Checkout URL and land
 * on Stripe in one tap. Checkout stays on Stripe-hosted web; nothing is
 * collected in the app.
 *
 * Any minting or URL-opening failure stays inside the app and exposes the
 * localized approval-email/support guidance rendered by the caller. It never
 * redirects to a different billing or pricing page.
 *
 * `canActivateTrialCheckout` comes from the server capability payload and is the
 * authority on whether the button exists at all; the platform check only decides
 * which native source to report. Callers that cannot supply the capability get
 * no button, which is the correct fail-closed default.
 */
export function useTrialActivation(
  businessId?: string | null,
  canActivateTrialCheckout = false,
) {
  const { i18n } = useTranslation();
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const checkoutEnabled = canActivateTrialCheckout && nativeCheckoutSource() !== null;

  const start = useCallback(async () => {
    setFailed(false);
    if (!checkoutEnabled || !businessId) {
      setFailed(true);
      return false;
    }
    setOpening(true);
    try {
      const result = await createTrialCheckoutUrl(businessId, i18n.language);
      if (result.ok && (await openWebsiteUrl(result.url))) return true;
      setFailed(true);
      return false;
    } finally {
      setOpening(false);
    }
  }, [businessId, checkoutEnabled, i18n.language]);

  return { checkoutEnabled, failed, opening, start };
}
