import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import { useRouter, type Href } from "expo-router";

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
  const initialDone = useRef(false);

  useEffect(() => {
    function navigate(url: string | null) {
      const dealId = extractDealId(url);
      if (dealId) {
        router.push(`/deal/${dealId}` as Href);
      }
    }

    const sub = Linking.addEventListener("url", ({ url }) => {
      navigate(url);
    });

    void (async () => {
      if (initialDone.current) return;
      initialDone.current = true;
      const initial = await Linking.getInitialURL();
      navigate(initial);
    })();

    return () => {
      sub.remove();
    };
  }, [router]);

  return null;
}
