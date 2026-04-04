import { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import Animated, {
  FadeIn,
  FadeInRight,
  FadeInLeft,
  FadeOut,
} from "react-native-reanimated";

import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { Colors, Radii, Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { parseFunctionError, EDGE_FUNCTION_TIMEOUT_AI_MS } from "@/lib/functions";

const STEPS = ["dashboard", "create", "track"] as const;
type Step = (typeof STEPS)[number];

const STEP_ICONS: Record<Step, string> = {
  dashboard: "\u{1F4CA}", // bar chart
  create: "\u{1F381}", // gift
  track: "\u{1F680}", // rocket
};

type AiSuggestion = { title: string; hint: string } | null;

export function WelcomeWalkthrough({
  visible,
  onDismiss,
  businessCategory,
  businessName,
  businessId,
}: {
  visible: boolean;
  onDismiss: () => void;
  businessCategory: string | null;
  businessName: string | null;
  businessId: string | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [stepIdx, setStepIdx] = useState(0);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const step = STEPS[stepIdx];

  // Fetch AI-suggested first deal when reaching step 3
  useEffect(() => {
    if (stepIdx !== 2 || aiSuggestion || aiLoading) return;
    if (!businessCategory && !businessName) return;

    let cancelled = false;
    setAiLoading(true);

    (async () => {
      try {
        const hint = businessCategory
          ? `BOGO deal for a ${businessCategory}`
          : "BOGO deal to attract first-time customers";

        const { data, error } = await supabase.functions.invoke(
          "ai-generate-deal-copy",
          {
            body: {
              hint_text: hint,
              business_name: businessName ?? "Local business",
              business_id: businessId,
            },
            timeout: EDGE_FUNCTION_TIMEOUT_AI_MS,
          },
        );

        if (!cancelled && !error && data?.title) {
          setAiSuggestion({ title: data.title, hint });
        }
      } catch {
        // AI suggestion is optional — fail silently
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stepIdx, aiSuggestion, aiLoading, businessCategory, businessName, businessId]);

  const goNext = useCallback(() => {
    if (stepIdx < STEPS.length - 1) {
      setDirection("forward");
      setStepIdx((i) => i + 1);
    }
  }, [stepIdx]);

  const goBack = useCallback(() => {
    if (stepIdx > 0) {
      setDirection("back");
      setStepIdx((i) => i - 1);
    }
  }, [stepIdx]);

  const handleCreateDeal = useCallback(() => {
    onDismiss();
    if (aiSuggestion) {
      router.push({
        pathname: "/create/quick",
        params: {
          prefillTitle: aiSuggestion.title,
          prefillHint: aiSuggestion.hint,
        },
      });
    } else {
      router.push("/create/quick");
    }
  }, [onDismiss, router, aiSuggestion]);

  const handleSkip = useCallback(() => {
    onDismiss();
  }, [onDismiss]);

  if (!visible) return null;

  const Entering = direction === "forward" ? FadeInRight : FadeInLeft;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={handleSkip}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.55)",
          justifyContent: "center",
          alignItems: "center",
          paddingHorizontal: Spacing.lg,
        }}
      >
        <Animated.View
          entering={FadeIn.duration(300)}
          style={{
            backgroundColor: Colors.light.background,
            borderRadius: Radii.card,
            padding: Spacing.xl,
            width: "100%",
            maxWidth: 380,
            shadowColor: "#000",
            shadowOpacity: 0.18,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 8 },
            elevation: 12,
          }}
        >
          {/* Step content */}
          <Animated.View
            key={stepIdx}
            entering={Entering.duration(280).springify()}
          >
            <Text
              style={{
                fontSize: 48,
                textAlign: "center",
                marginBottom: Spacing.md,
              }}
            >
              {STEP_ICONS[step]}
            </Text>
            <Text
              style={{
                fontSize: 22,
                fontWeight: "800",
                textAlign: "center",
                color: Colors.light.text,
                letterSpacing: -0.3,
                marginBottom: Spacing.sm,
              }}
            >
              {t(`walkthrough.${step}Title`)}
            </Text>
            <Text
              style={{
                fontSize: 15,
                lineHeight: 22,
                textAlign: "center",
                color: Colors.light.text,
                opacity: 0.7,
                fontWeight: "500",
              }}
            >
              {t(`walkthrough.${step}Body`)}
            </Text>

            {/* AI suggestion on final step */}
            {stepIdx === 2 && aiSuggestion ? (
              <View
                style={{
                  marginTop: Spacing.lg,
                  backgroundColor: Colors.light.surfaceMuted,
                  borderRadius: Radii.lg,
                  padding: Spacing.md,
                  borderWidth: 1.5,
                  borderColor: Colors.light.primary,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "800",
                    color: Colors.light.primary,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    marginBottom: 4,
                  }}
                >
                  {t("walkthrough.aiSuggestionLabel")}
                </Text>
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: "700",
                    color: Colors.light.text,
                  }}
                >
                  {aiSuggestion.title}
                </Text>
              </View>
            ) : null}

            {stepIdx === 2 && aiLoading ? (
              <Text
                style={{
                  marginTop: Spacing.lg,
                  textAlign: "center",
                  fontSize: 13,
                  opacity: 0.5,
                  fontWeight: "600",
                }}
              >
                {t("walkthrough.aiLoading")}
              </Text>
            ) : null}
          </Animated.View>

          {/* Dot indicators */}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "center",
              gap: 8,
              marginTop: Spacing.xl,
              marginBottom: Spacing.lg,
            }}
          >
            {STEPS.map((_, i) => (
              <View
                key={i}
                style={{
                  width: i === stepIdx ? 24 : 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor:
                    i === stepIdx
                      ? Colors.light.primary
                      : Colors.light.border,
                }}
              />
            ))}
          </View>

          {/* Buttons */}
          {stepIdx < STEPS.length - 1 ? (
            <View style={{ gap: Spacing.sm }}>
              <PrimaryButton
                title={t("walkthrough.next")}
                onPress={goNext}
              />
              {stepIdx > 0 ? (
                <SecondaryButton
                  title={t("walkthrough.back")}
                  onPress={goBack}
                />
              ) : (
                <Pressable
                  onPress={handleSkip}
                  style={{ alignSelf: "center", paddingVertical: Spacing.sm }}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: "700",
                      color: Colors.light.mutedText,
                    }}
                  >
                    {t("walkthrough.skip")}
                  </Text>
                </Pressable>
              )}
            </View>
          ) : (
            <View style={{ gap: Spacing.sm }}>
              <PrimaryButton
                title={
                  aiSuggestion
                    ? t("walkthrough.useAiDeal")
                    : t("walkthrough.createFirstDeal")
                }
                onPress={handleCreateDeal}
              />
              <SecondaryButton
                title={t("walkthrough.exploreDashboard")}
                onPress={handleSkip}
              />
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}
