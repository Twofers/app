import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Colors, Gray, PrimaryTint, Radii } from "@/constants/theme";
import { Spacing } from "@/lib/screen-layout";
import { useColorScheme } from "@/hooks/use-color-scheme";

export type ConsumerDealStatusKey = "live" | "claimed" | "redeeming" | "redeemed" | "expired" | "canceled" | "released";

// Live/claimed/redeeming = brand orange; redeemed = the one success green
// (redemption confirmation); terminal states = neutral gray.
const styles: Record<
  ConsumerDealStatusKey,
  { background: string; text: string }
> = {
  live: { background: PrimaryTint.surfaceStrong, text: "#B45309" },
  claimed: { background: PrimaryTint.surface, text: "#B45309" },
  redeeming: { background: PrimaryTint.surface, text: "#B45309" },
  redeemed: { background: "rgba(22,163,74,0.14)", text: "#16A34A" },
  expired: { background: Gray[100], text: Gray[600] },
  canceled: { background: Gray[100], text: Gray[500] },
  released: { background: Gray[100], text: Gray[500] },
};

type DealStatusPillProps = {
  status: ConsumerDealStatusKey;
  labelOverride?: string;
};

export function DealStatusPill({ status, labelOverride }: DealStatusPillProps) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const c =
    colorScheme === "dark"
      ? {
          live: { background: "rgba(255,159,28,0.18)", text: theme.accentText },
          claimed: { background: "rgba(255,159,28,0.14)", text: theme.accentText },
          redeeming: { background: "rgba(255,159,28,0.14)", text: theme.accentText },
          redeemed: { background: "rgba(74,222,128,0.14)", text: theme.success },
          expired: { background: theme.surfaceMuted, text: theme.mutedText },
          canceled: { background: theme.surfaceMuted, text: theme.mutedText },
          released: { background: theme.surfaceMuted, text: theme.mutedText },
        }[status]
      : styles[status];
  const label = labelOverride ?? (
    status === "live"
      ? t("dealStatus.live")
      : status === "claimed"
        ? t("dealStatus.claimed")
        : status === "redeeming"
          ? t("dealStatus.redeeming")
          : status === "redeemed"
            ? t("dealStatus.redeemed")
          : status === "canceled"
            ? t("dealStatus.canceled")
            : status === "released"
              ? t("dealStatus.released", { defaultValue: "Released" })
              : t("dealStatus.expired")
  );

  return (
    <View
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: Spacing.sm,
        paddingVertical: 5,
        borderRadius: Radii.sm,
        backgroundColor: c.background,
        maxWidth: "100%",
      }}
    >
      <Text
        style={{ fontSize: 12, fontWeight: "800", color: c.text, letterSpacing: 0.3 }}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.76}
        maxFontSizeMultiplier={1.15}
      >
        {label}
      </Text>
    </View>
  );
}
