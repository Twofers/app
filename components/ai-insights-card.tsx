import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import Animated, { FadeInDown } from "react-native-reanimated";

import { CardShell } from "@/components/ui/card-shell";
import { Colors, Spacing, Radii } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { parseFunctionError, EDGE_FUNCTION_TIMEOUT_AI_MS } from "@/lib/functions";

type Suggestion = {
  icon: string;
  title: string;
  body: string;
};

type AiInsightsCardProps = {
  businessId: string;
  businessName: string | null;
  businessCategory: string | null;
  weekCounts: number[];
  dealTitles: string[];
  totalClaims: number;
  totalRedeems: number;
  dealsLaunched: number;
};

export function AiInsightsCard({
  businessId,
  businessName,
  businessCategory,
  weekCounts,
  dealTitles,
  totalClaims,
  totalRedeems,
  dealsLaunched,
}: AiInsightsCardProps) {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  const fetchSuggestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "ai-deal-suggestions",
        {
          body: {
            business_id: businessId,
            business_name: businessName,
            business_category: businessCategory,
            weekly_claims_by_day: weekCounts,
            top_deal_titles: dealTitles,
            total_claims: totalClaims,
            total_redeems: totalRedeems,
            month_deals_launched: dealsLaunched,
          },
          timeout: EDGE_FUNCTION_TIMEOUT_AI_MS,
        },
      );

      if (fnError) {
        setError(parseFunctionError(fnError));
        return;
      }

      if (data?.suggestions && Array.isArray(data.suggestions)) {
        setSuggestions(data.suggestions);
      } else {
        setError(t("aiInsights.noSuggestions"));
      }
    } catch (err) {
      setError(parseFunctionError(err));
    } finally {
      setLoading(false);
      setFetched(true);
    }
  }, [
    businessId,
    businessName,
    businessCategory,
    weekCounts,
    dealTitles,
    totalClaims,
    totalRedeems,
    dealsLaunched,
    t,
  ]);

  // Auto-fetch on mount
  useEffect(() => {
    if (!fetched) {
      void fetchSuggestions();
    }
  }, [fetched, fetchSuggestions]);

  const primary = Colors.light.primary;

  return (
    <Animated.View entering={FadeInDown.duration(440).delay(80).springify()}>
      <CardShell>
        {/* Header with accent bar */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: Spacing.sm,
            marginBottom: Spacing.md,
          }}
        >
          <View
            style={{
              width: 4,
              height: 22,
              borderRadius: 2,
              backgroundColor: primary,
            }}
          />
          <Text
            style={{
              fontWeight: "800",
              fontSize: 15,
              color: Colors.light.text,
              flex: 1,
            }}
          >
            {t("aiInsights.title")}
          </Text>
          {!loading ? (
            <Pressable onPress={fetchSuggestions} accessibilityRole="button">
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "700",
                  color: primary,
                }}
              >
                {t("aiInsights.refresh")}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* Loading state */}
        {loading ? (
          <View
            style={{
              paddingVertical: Spacing.lg,
              alignItems: "center",
              gap: Spacing.sm,
            }}
          >
            <ActivityIndicator color={primary} />
            <Text
              style={{
                fontSize: 13,
                fontWeight: "600",
                opacity: 0.5,
              }}
            >
              {t("aiInsights.loading")}
            </Text>
          </View>
        ) : error ? (
          /* Error state */
          <Text
            style={{
              fontSize: 14,
              lineHeight: 20,
              opacity: 0.6,
              fontWeight: "500",
            }}
          >
            {error}
          </Text>
        ) : (
          /* Suggestions list */
          <View style={{ gap: Spacing.md }}>
            {suggestions.map((s, i) => (
              <View
                key={i}
                style={{
                  flexDirection: "row",
                  gap: Spacing.sm,
                  alignItems: "flex-start",
                }}
              >
                <Text style={{ fontSize: 20, marginTop: 1 }}>{s.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: "700",
                      color: Colors.light.text,
                      marginBottom: 2,
                    }}
                  >
                    {s.title}
                  </Text>
                  <Text
                    style={{
                      fontSize: 13,
                      lineHeight: 19,
                      color: Colors.light.text,
                      opacity: 0.65,
                      fontWeight: "500",
                    }}
                  >
                    {s.body}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </CardShell>
    </Animated.View>
  );
}
