import { useEffect, useRef } from "react";
import * as Linking from "expo-linking";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";

import { useBrandedConfirm } from "@/hooks/use-branded-confirm";
import { interpretShareLookup, parseShareLink } from "@/lib/deal-share-link";
import { runWhenBridgeSettled } from "@/lib/run-when-bridge-settled";
import { claimInitialUrl } from "@/lib/initial-url-guard";
import { supabase } from "@/lib/supabase";

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

function shouldHandleDealDeepLink(url: string | null): boolean {
  if (extractDealId(url)) return true;
  return parseShareLink(url).type !== "none";
}

/**
 * Listens for deep links (custom scheme, HTTPS edge function URLs, and public
 * share links like https://www.twoferapp.com/s/<code>) and navigates to
 * /deal/[id] when a deal link is detected.
 */
export function DealDeepLinkHandler() {
  const router = useRouter();
  const { t } = useTranslation();
  const { confirm, confirmModal } = useBrandedConfirm();
  const initialDone = useRef(false);

  useEffect(() => {
    function showInvalidLink() {
      confirm({
        iconName: "link-off",
        title: t("commonUi.invalidDealLinkTitle"),
        message: t("commonUi.invalidDealLinkBody"),
        confirmLabel: t("commonUi.ok"),
      });
    }

    async function resolveShareCode(shareCode: string) {
      const { data, error } = await supabase.rpc("lookup_deal_share", {
        lookup_code: shareCode,
      });
      const resolution = interpretShareLookup(data, error);
      if (resolution.status === "valid") {
        router.push(`/deal/${resolution.dealId}` as Href);
        return;
      }
      confirm({
        iconName: "link-off",
        title:
          resolution.status === "unavailable"
            ? t("shareDeal.linkUnavailableTitle")
            : t("shareDeal.linkErrorTitle"),
        message:
          resolution.status === "unavailable"
            ? t("shareDeal.linkUnavailableBody")
            : t("shareDeal.linkErrorBody"),
        confirmLabel: t("commonUi.ok"),
      });
    }

    function navigate(url: string | null) {
      const dealId = extractDealId(url);
      if (dealId) {
        if (!UUID_RE.test(dealId)) {
          showInvalidLink();
          return;
        }
        router.push(`/deal/${dealId}` as Href);
        return;
      }

      const share = parseShareLink(url);
      if (share.type === "invalid") {
        showInvalidLink();
        return;
      }
      if (share.type === "code") {
        void resolveShareCode(share.code).catch(() => {
          confirm({
            iconName: "link-off",
            title: t("shareDeal.linkErrorTitle"),
            message: t("shareDeal.linkErrorBody"),
            confirmLabel: t("commonUi.ok"),
          });
        });
      }
    }

    const sub = Linking.addEventListener("url", ({ url }) => {
      navigate(url);
    });

    void (async () => {
      if (initialDone.current) return;
      initialDone.current = true;
      const initial = await Linking.getInitialURL();
      if (!shouldHandleDealDeepLink(initial)) return;
      if (!claimInitialUrl()) return;
      runWhenBridgeSettled(() => navigate(initial));
    })();

    return () => {
      sub.remove();
    };
  }, [confirm, router, t]);

  return confirmModal;
}
