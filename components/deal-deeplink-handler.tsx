import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import * as Linking from "expo-linking";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";

import { runWhenBridgeSettled } from "@/lib/run-when-bridge-settled";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extracts a deal ID from incoming URLs:
 *  - twoforone://deal/<uuid>           (custom scheme)
 *  - https://.../functions/v1/deal-link?id=<uuid>  (edge function HTTPS)
 */
function extractDealId(url: string | null): string | null {
  if (!url) return null;

  const schemeMatch = url.match(/^twoforone:\/\/deal\/([a-f0-9-]+)/i);
  if (schemeMatch?.[1]) return schemeMatch[1];

  try {
    const parsed = new URL(url);
    if (parsed.pathname.includes("/deal-link")) {
      const id = parsed.searchParams.get("id")?.trim();
      if (id) return id;
    }
  } catch {
    /* not a valid URL */
  }

  return null;
}

/**
 * Listens for deep links (custom scheme and HTTPS edge function URLs) and
 * navigates to /deal/[id] when a deal link is detected.
 */
export function DealDeepLinkHandler() {
  const router = useRouter();
  const { t } = useTranslation();
  const initialDone = useRef(false);

  useEffect(() => {
    function navigate(url: string | null) {
      const dealId = extractDealId(url);
      if (!dealId) return;
      if (!UUID_RE.test(dealId)) {
        Alert.alert(t("commonUi.invalidDealLinkTitle"), t("commonUi.invalidDealLinkBody"));
        return;
      }
      router.push(`/deal/${dealId}` as Href);
    }

    const sub = Linking.addEventListener("url", ({ url }) => {
      navigate(url);
    });

    void (async () => {
      if (initialDone.current) return;
      initialDone.current = true;
      const initial = await Linking.getInitialURL();
      runWhenBridgeSettled(() => navigate(initial));
    })();

    return () => {
      sub.remove();
    };
  }, [router, t]);

  return null;
}
