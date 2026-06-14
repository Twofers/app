import { useEffect, useRef } from "react";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { devLog, devWarn } from "@/lib/dev-log";
import { normalizeLegacyTabsDeepLink } from "@/lib/normalize-legacy-tabs-deep-link";
import { runWhenBridgeSettled } from "@/lib/run-when-bridge-settled";
import { claimInitialUrl } from "@/lib/initial-url-guard";

/**
 * Accepts `scheme://tabs/<segment>` and `scheme:///tabs/<segment>` style URLs that
 * do not match Expo Router's real paths (group `(tabs)` is not `tabs` in the URL).
 */
export function LegacyTabsDeepLinkHandler() {
  const router = useRouter();
  const initialDone = useRef(false);

  useEffect(() => {
    if (__DEV__) {
      try {
        devLog(
          "[deeplink] example canonical tab URLs",
          Linking.createURL("/(tabs)/redeem"),
          Linking.createURL("/(tabs)/"),
        );
      } catch (e) {
        devWarn("[deeplink] createURL sample failed (non-fatal)", e);
      }
    }

    const handleHref = (href: ReturnType<typeof normalizeLegacyTabsDeepLink>, url: string) => {
      if (href) {
        if (__DEV__) devLog("[deeplink] legacy /tabs/* normalized to", href, "from", url);
        router.replace(href);
      }
    };

    const handle = (url: string) => {
      handleHref(normalizeLegacyTabsDeepLink(url), url);
    };

    void Linking.getInitialURL().then((url) => {
      if (!url || initialDone.current) return;
      const href = normalizeLegacyTabsDeepLink(url);
      if (!href || !claimInitialUrl()) return;
      initialDone.current = true;
      runWhenBridgeSettled(() => handleHref(href, url));
    });

    const sub = Linking.addEventListener("url", ({ url }) => handle(url));
    return () => sub.remove();
  }, [router]);

  return null;
}
