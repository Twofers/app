import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Spacing } from "@/lib/screen-layout";

export type ConsumerDealStatusKey = "live" | "claimed" | "redeeming" | "redeemed" | "expired" | "canceled";

const styles: Record<
  ConsumerDealStatusKey,
  { background: string; text: string }
> = {
  live: { background: "#dcfce7", text: "#166534" },
  claimed: { background: "#dbeafe", text: "#1e40af" },
  redeeming: { background: "#fef3c7", text: "#92400e" },
  redeemed: { background: "#e8f5e9", text: "#1b5e20" },
  expired: { background: "#f4f4f5", text: "#52525b" },
  canceled: { background: "#f4f4f5", text: "#71717a" },
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
        borderRadius: 10,
        backgroundColor: c.background,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: "800", color: c.text, letterSpacing: 0.3 }}>{label}</Text>
    </View>
  );
}
