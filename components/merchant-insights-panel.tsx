import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import type { MerchantInsightsRow, RepeatVisitStats } from "@/lib/merchant-insights";
import { Spacing } from "@/lib/screen-layout";

// Raw ids the server may emit that have no translation (demo_seed, future
// sources, …) must never leak into the UI — they collapse into the localized
// "Other" / "Unknown" buckets so labels stay friendly and consistently cased.
function formatAcquisitionLabel(key: string, t: (k: string) => string) {
  const k = `merchantInsights.acquisition.${key}`;
  const s = t(k);
  return s === k ? t("merchantInsights.acquisition.other") : s;
}

function formatMethodLabel(key: string, t: (k: string) => string) {
  if (key === "visual") return t("merchantInsights.methodVisual");
  if (key === "qr") return t("merchantInsights.methodQr");
  if (key === "pending") return t("merchantInsights.methodPending");
  return t("merchantInsights.claimBlockedReasons.unknown");
}

function formatClaimBlockedReasonLabel(key: string, t: (k: string) => string) {
  const k = `merchantInsights.claimBlockedReasons.${key}`;
  const s = t(k);
  return s === k ? t("merchantInsights.claimBlockedReasons.unknown") : s;
}

type Props = {
  insights: MerchantInsightsRow | null;
  /** Aggregate favorites count (business_saved_customers_count RPC); null hides the line. */
  savedCustomersCount?: number | null;
  /** Redemption-confirmed repeat visits (business_repeat_visit_stats RPC); null hides the line. */
  repeatVisitStats?: RepeatVisitStats | null;
};

export function MerchantInsightsPanel({
  insights,
  savedCustomersCount = null,
  repeatVisitStats = null,
}: Props) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
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
      <Text style={{ fontWeight: "700", fontSize: 15, color: theme.text }}>{t("merchantInsights.detailTitle")}</Text>
      <Text style={{ fontSize: 14, color: theme.mutedText, lineHeight: 20 }}>
        {t("merchantInsights.avgRedeemDelay")}: {avgLine}
      </Text>
      {/* "Repeat" here means a prior claim at this business, not a confirmed
          second visit — the RPC (merchant_business_insights) flags claims with
          any earlier claim, redeemed or not. Copy must not say "returning". */}
      <Text style={{ fontSize: 14, color: theme.mutedText, lineHeight: 20 }}>
        {t("merchantInsights.newVsReturning", {
          new: insights.new_customer_claims,
          returning: insights.returning_customer_claims,
        })}
      </Text>
      {savedCustomersCount != null ? (
        <Text style={{ fontSize: 14, color: theme.mutedText, lineHeight: 20 }}>
          {t("merchantInsights.savedCustomers", {
            defaultValue: "Customers who saved this business: {{count}}",
            count: savedCustomersCount,
          })}
        </Text>
      ) : null}
      {repeatVisitStats != null ? (
        <Text style={{ fontSize: 14, color: theme.mutedText, lineHeight: 20 }}>
          {t("merchantInsights.repeatVisits", {
            defaultValue: "Confirmed repeat customers: {{repeat}} of {{total}} redeemers came back",
            repeat: repeatVisitStats.repeat_customers,
            total: repeatVisitStats.redeemed_customers,
          })}
        </Text>
      ) : null}

      {mixEntries(insights.age_band_mix).length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={{ fontWeight: "600", fontSize: 14, color: theme.text }}>{t("merchantInsights.ageMix")}</Text>
          {mixEntries(insights.age_band_mix).map(([k, n]) => (
            <Text key={k} style={{ fontSize: 13, color: theme.mutedText }}>
              {t(`ageBands.${k}`, { defaultValue: k })}: {n}
            </Text>
          ))}
        </View>
      ) : null}

      {mixEntries(insights.zip_cluster_mix).length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={{ fontWeight: "600", fontSize: 14, color: theme.text }}>{t("merchantInsights.zipMix")}</Text>
          {mixEntries(insights.zip_cluster_mix).map(([k, n]) => (
            <Text key={k} style={{ fontSize: 13, color: theme.mutedText }}>
              {k}: {n}
            </Text>
          ))}
        </View>
      ) : null}

      {mixEntries(insights.acquisition_mix).length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={{ fontWeight: "600", fontSize: 14, color: theme.text }}>{t("merchantInsights.acqMix")}</Text>
          {mixEntries(insights.acquisition_mix).map(([k, n]) => (
            <Text key={k} style={{ fontSize: 13, color: theme.mutedText }}>
              {formatAcquisitionLabel(k, t)}: {n}
            </Text>
          ))}
        </View>
      ) : null}

      {mixEntries(insights.redeem_method_mix).length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={{ fontWeight: "600", fontSize: 14, color: theme.text }}>{t("merchantInsights.methodMix")}</Text>
          {mixEntries(insights.redeem_method_mix).map(([k, n]) => (
            <Text key={k} style={{ fontSize: 13, color: theme.mutedText }}>
              {formatMethodLabel(k, t)}: {n}
            </Text>
          ))}
        </View>
      ) : null}

      {mixEntries(insights.claim_blocked_reason_mix).length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={{ fontWeight: "600", fontSize: 14, color: theme.text }}>{t("merchantInsights.claimBlockedMix")}</Text>
          {mixEntries(insights.claim_blocked_reason_mix).map(([k, n]) => (
            <Text key={k} style={{ fontSize: 13, color: theme.mutedText }}>
              {formatClaimBlockedReasonLabel(k, t)}: {n}
            </Text>
          ))}
        </View>
      ) : null}

      {peakHour.c > 0 ? (
        <Text style={{ fontSize: 13, color: theme.mutedText, lineHeight: 18 }}>
          {t("merchantInsights.hourHeat")}: {t("merchantInsights.hourPeak", { hour: peakHour.h, count: peakHour.c })}
        </Text>
      ) : (
        <Text style={{ fontSize: 13, color: theme.mutedText, lineHeight: 18 }}>{t("merchantInsights.hourHeatSparse")}</Text>
      )}
    </View>
  );
}
