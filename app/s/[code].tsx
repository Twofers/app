import { useEffect, useMemo } from "react";
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";

import { useBrandedConfirm } from "@/hooks/use-branded-confirm";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { interpretShareLookup, parseShareLink } from "@/lib/deal-share-link";
import { supabase } from "@/lib/supabase";

function firstParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim().length > 0) return value[0];
  return null;
}

export default function ShareCodeRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const { t } = useTranslation();
  const { confirm, confirmModal } = useBrandedConfirm();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const code = firstParam(params.code);
  const parsed = useMemo(() => parseShareLink(code ? `https://www.twoferapp.com/s/${code}` : null), [code]);

  useEffect(() => {
    let cancelled = false;

    function goHome() {
      router.replace("/(tabs)" as Href);
    }

    function showInvalidLink() {
      confirm({
        iconName: "link-off",
        title: t("commonUi.invalidDealLinkTitle"),
        message: t("commonUi.invalidDealLinkBody"),
        confirmLabel: t("commonUi.ok"),
        onConfirm: goHome,
      });
    }

    if (parsed.type !== "code") {
      showInvalidLink();
      return;
    }

    void (async () => {
      try {
        const { data, error } = await supabase.rpc("lookup_deal_share", {
          lookup_code: parsed.code,
        });
        if (cancelled) return;
        const resolution = interpretShareLookup(data, error);
        if (resolution.status === "valid") {
          router.replace(`/deal/${resolution.dealId}` as Href);
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
          onConfirm: goHome,
        });
      } catch {
        if (cancelled) return;
        confirm({
          iconName: "link-off",
          title: t("shareDeal.linkErrorTitle"),
          message: t("shareDeal.linkErrorBody"),
          confirmLabel: t("commonUi.ok"),
          onConfirm: goHome,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [confirm, parsed, router, t]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.background }}>
      <ActivityIndicator color={theme.primary} />
      {confirmModal}
    </View>
  );
}
