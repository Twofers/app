import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import i18n from "@/lib/i18n/config";
import { hydrateUiLocale } from "@/lib/locale/ui-locale-storage";

/**
 * Hydrates persisted / device UI language before showing localized routes.
 * English renders first in i18n config; we switch before first meaningful paint.
 */
export function AppI18nGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const locale = await hydrateUiLocale();
      await i18n.changeLanguage(locale);
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <>{children}</>;
}
