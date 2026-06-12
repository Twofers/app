import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Gray, PrimaryTint, Radii } from "@/constants/theme";
import { Spacing } from "@/lib/screen-layout";

export type ConsumerDealStatusKey = "live" | "claimed" | "redeeming" | "redeemed" | "expired" | "canceled";

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
};

type DealStatusPillProps = {
  status: ConsumerDealStatusKey;
};

export function DealStatusPill({ status }: DealStatusPillProps) {
  const { t } = useTranslation();
  const c = styles[status];
  const label =
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
              : t("dealStatus.expired");

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
