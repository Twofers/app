import { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Colors, Spacing } from "@/constants/theme";

/**
 * Lightweight offline banner using the browser/RN fetch-based connectivity check.
 * Uses window.addEventListener on web, AppState + fetch on native.
 * No extra dependency required.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (Platform.OS === "web") {
      const update = () => setOffline(!navigator.onLine);
      window.addEventListener("online", update);
      window.addEventListener("offline", update);
      update();
      return () => {
        window.removeEventListener("online", update);
        window.removeEventListener("offline", update);
      };
    }

    // Native: periodic lightweight connectivity check
    let mounted = true;
    const check = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        await fetch("https://clients3.google.com/generate_204", {
          method: "HEAD",
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (mounted) setOffline(false);
      } catch {
        if (mounted) setOffline(true);
      }
    };

    void check();
    const interval = setInterval(check, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  if (!offline) return null;

  return (
    <View
      style={{
        backgroundColor: Colors.light.secondary,
        paddingVertical: Spacing.sm,
        paddingHorizontal: Spacing.lg,
        alignItems: "center",
      }}
    >
      <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>
        {t("offline.banner")}
      </Text>
    </View>
  );
}
