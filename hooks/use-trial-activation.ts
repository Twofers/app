import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { createTrialCheckoutUrl } from "@/lib/billing-activation";
import { BUSINESS_START_TRIAL_URL, openWebsiteUrl } from "@/lib/legal-urls";

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
 * Falls back to the website billing page whenever minting is not possible
 * (no business id yet, offline, activation gate off, already activated), so the
 * button never dead-ends.
 */
export function useTrialActivation(businessId?: string | null) {
  const { i18n } = useTranslation();
  const [opening, setOpening] = useState(false);

  const start = useCallback(async () => {
    if (!businessId) {
      await openWebsiteUrl(BUSINESS_START_TRIAL_URL);
      return;
    }
    setOpening(true);
    try {
      const result = await createTrialCheckoutUrl(businessId, i18n.language);
      if (result.ok && (await openWebsiteUrl(result.url))) return;
      await openWebsiteUrl(BUSINESS_START_TRIAL_URL);
    } finally {
      setOpening(false);
    }
  }, [businessId, i18n.language]);

  return { opening, start };
}
