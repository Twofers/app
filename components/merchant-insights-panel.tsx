import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { MerchantInsightsRow } from "@/lib/merchant-insights";
import { Spacing } from "@/lib/screen-layout";

function formatAcquisitionLabel(key: string, t: (k: string) => string) {
  const k = `merchantInsights.acquisition.${key}`;
  const s = t(k);
  return s === k ? key : s;
}

function formatMethodLabel(key: string, t: (k: string) => string) {
  if (key === "visual") return t("merchantInsights.methodVisual");
  if (key === "qr") return t("merchantInsights.methodQr");
  if (key === "pending") return t("merchantInsights.methodPending");
  return key;
}

type Props = {
  insights: MerchantInsightsRow | null;
};

export function MerchantInsightsPanel({ insights }: Props) {
  const { t } = useTranslation();
  if (!insights || insights.claims < 1) return null;

  const avgSec = insights.avg_claim_to_redeem_seconds;
  const avgLine =
    avgSec != null && Number.isFinite(avgSec) && insights.redeems > 0
      ? t("merchantInsights.avgRedeemDelayMinutes", { minutes: Math.max(1, Math.round(avgSec / 60)) })
      : t("merchantInsights.avgRedeemDelayNone");

  const mixEntries = (o: Record<string, number>) =>
    Object.entries(o)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);

  const peakHour = insights.claims_by_hour_local.reduce(
    (best, c, h) => (c > best.c ? { h, c } : best),
    { h: 0, c: -1 },
  );

  return (
    <View style={{ gap: Spacing.md, marginBottom: Spacing.lg }}>
      <Text style={{ fontWeight: "700", fontSize: 15 }}>{t("merchantInsights.detailTitle")}</Text>
      <Text style={{ fontSize: 14, opacity: 0.75, lineHeight: 20 }}>
        {t("merchantInsights.avgRedeemDelay")}: {avgLine}
      </Text>
      <Text style={{ fontSize: 14, opacity: 0.75, lineHeight: 20 }}>
        {t("merchantInsights.newVsReturning", {
          new: insights.new_customer_claims,
          returning: insights.returning_customer_claims,
        })}
      </Text>

      {mixEntries(insights.age_band_mix).length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={{ fontWeight: "600", fontSize: 14 }}>{t("merchantInsights.ageMix")}</Text>
          {mixEntries(insights.age_band_mix).map(([k, n]) => (
            <Text key={k} style={{ fontSize: 13, opacity: 0.72 }}>
              {t(`ageBands.${k}`, { defaultValue: k })}: {n}
            </Text>
          ))}
        </View>
      ) : null}

      {mixEntries(insights.zip_cluster_mix).length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={{ fontWeight: "600", fontSize: 14 }}>{t("merchantInsights.zipMix")}</Text>
          {mixEntries(insights.zip_cluster_mix).map(([k, n]) => (
            <Text key={k} style={{ fontSize: 13, opacity: 0.72 }}>
              {k}: {n}
            </Text>
          ))}
        </View>
      ) : null}

      {mixEntries(insights.acquisition_mix).length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={{ fontWeight: "600", fontSize: 14 }}>{t("merchantInsights.acqMix")}</Text>
          {mixEntries(insights.acquisition_mix).map(([k, n]) => (
            <Text key={k} style={{ fontSize: 13, opacity: 0.72 }}>
              {formatAcquisitionLabel(k, t)}: {n}
            </Text>
          ))}
        </View>
      ) : null}

      {mixEntries(insights.redeem_method_mix).length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={{ fontWeight: "600", fontSize: 14 }}>{t("merchantInsights.methodMix")}</Text>
          {mixEntries(insights.redeem_method_mix).map(([k, n]) => (
            <Text key={k} style={{ fontSize: 13, opacity: 0.72 }}>
              {formatMethodLabel(k, t)}: {n}
            </Text>
          ))}
        </View>
      ) : null}

      {peakHour.c > 0 ? (
        <Text style={{ fontSize: 13, opacity: 0.72, lineHeight: 18 }}>
          {t("merchantInsights.hourHeat")}: {t("merchantInsights.hourPeak", { hour: peakHour.h, count: peakHour.c })}
        </Text>
      ) : (
        <Text style={{ fontSize: 13, opacity: 0.72, lineHeight: 18 }}>{t("merchantInsights.hourHeatSparse")}</Text>
      )}
    </View>
  );
}
