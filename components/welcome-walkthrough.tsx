import { useCallback, useEffect, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import Animated, {
  FadeIn,
  FadeInRight,
  FadeInLeft,
} from "react-native-reanimated";

import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { Colors, Radii, Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { EDGE_FUNCTION_TIMEOUT_AI_MS } from "@/lib/functions";
import { useColorScheme } from "@/hooks/use-color-scheme";

const STEPS = ["dashboard", "create", "track"] as const;
type Step = (typeof STEPS)[number];

// Brand imagery instead of emoji: the dashboard step shows the Twofer mark; the
// other steps use brand-orange icons.
const STEP_MATERIAL_ICONS: Record<Exclude<Step, "dashboard">, keyof typeof MaterialIcons.glyphMap> = {
  create: "card-giftcard",
  track: "trending-up",
};

function StepBadge({ step }: { step: Step }) {
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  return (
    <View
      style={{
        alignSelf: "center",
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: "rgba(255,159,28,0.14)",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: Spacing.md,
      }}
    >
      {step === "dashboard" ? (
        <Image
          source={require("../assets/images/twofer-mark-512.png")}
          style={{ width: 34, height: 34 }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <MaterialIcons name={STEP_MATERIAL_ICONS[step]} size={32} color={theme.primary} />
      )}
    </View>
  );
}

type AiSuggestion = { title: string; hint: string } | null;

function categoryStarterKey(category: string | null | undefined): "cafe" | "restaurant" | "retail" | "default" {
  const key = category?.trim().toLowerCase() ?? "";
  if (/\b(cafe|coffee|bakery|tea)\b/.test(key)) return "cafe";
  if (/\b(restaurant|food|pizza|taco|sandwich|bar|grill)\b/.test(key)) return "restaurant";
  if (/\b(retail|shop|store|boutique)\b/.test(key)) return "retail";
  return "default";
}

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
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];

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
          ? `Buy-one-get-one deal for a ${businessCategory}`
          : "Buy-one-get-one deal to attract first-time customers";

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
        pathname: "/create/ai",
        params: {
          prefillTitle: aiSuggestion.title,
          prefillHint: aiSuggestion.hint,
        },
      });
    } else {
      router.push("/create/ai");
    }
  }, [onDismiss, router, aiSuggestion]);

  const handleSkip = useCallback(() => {
    onDismiss();
  }, [onDismiss]);

  if (!visible) return null;

  const Entering = direction === "forward" ? FadeInRight : FadeInLeft;
  const fallbackStarterKey = categoryStarterKey(businessCategory);
  const fallbackSuggestion = {
    title: t(`walkthrough.starterDeal.${fallbackStarterKey}.title`),
    hint: t(`walkthrough.starterDeal.${fallbackStarterKey}.hint`),
  };
  const displayedSuggestion = aiSuggestion ?? (!aiLoading && stepIdx === 2 ? fallbackSuggestion : null);

  return (
      <View
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          zIndex: 20,
          elevation: 20,
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
            backgroundColor: theme.background,
            borderRadius: Radii.lg,
            padding: Spacing.xl,
            width: "100%",
            maxWidth: 380,
            borderWidth: 1,
            borderColor: theme.border,
          }}
        >
          {/* Step content */}
          <Animated.View
            key={stepIdx}
            entering={Entering.duration(280).springify()}
          >
            <StepBadge step={step} />
            <Text
              style={{
                fontSize: 22,
                fontWeight: "800",
                textAlign: "center",
                color: theme.text,
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
                color: theme.text,
                opacity: 0.7,
                fontWeight: "500",
              }}
            >
              {t(`walkthrough.${step}Body`)}
            </Text>

            {/* AI suggestion on final step */}
            {stepIdx === 2 && displayedSuggestion ? (
              <View
                style={{
                  marginTop: Spacing.lg,
                  backgroundColor: theme.surfaceMuted,
                  borderRadius: Radii.lg,
                  padding: Spacing.md,
                  borderWidth: 1.5,
                  borderColor: theme.primary,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "800",
                    color: theme.accentText,
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
                    color: theme.text,
                  }}
                >
                  {displayedSuggestion.title}
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
                  color: theme.text,
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
                      ? theme.primary
                      : theme.border,
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
                      color: theme.mutedText,
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
                  displayedSuggestion
                    ? t("walkthrough.useAiDeal")
                    : t("walkthrough.createFirstDeal")
                }
                onPress={() => {
                  if (!aiSuggestion && displayedSuggestion) {
                    onDismiss();
                    router.push({
                      pathname: "/create/ai",
                      params: {
                        prefillTitle: displayedSuggestion.title,
                        prefillHint: displayedSuggestion.hint,
                        fromCreateHub: "1",
                      },
                    });
                    return;
                  }
                  handleCreateDeal();
                }}
              />
              <SecondaryButton
                title={t("walkthrough.exploreDashboard")}
                onPress={handleSkip}
              />
            </View>
          )}
        </Animated.View>
      </View>
  );
}
