import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { Gray } from "@/constants/theme";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { useTabMode } from "@/lib/tab-mode";
import {
  canLoadAiDealStudioDevRoutes,
  getAppExtra,
  getBuildProfileLabel,
  getExpoAppVersion,
  getExecutionEnvironment,
  getNativeBuildLabel,
  getPublicEnvSnapshot,
  isAiStudioDevAppVariant,
  isPreviewOrDevClientProfile,
  isSupabaseConfigured,
} from "@/lib/runtime-env";

export default function DebugDiagnosticsScreen() {
  const router = useRouter();
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { i18n } = useTranslation();
  const { session } = useAuthSession();
  const { mode, ready: tabReady } = useTabMode();
  const authSnap = useMemo(
    () => ({
      error: null as string | null,
      userId: session?.user?.id ?? null,
      email: session?.user?.email ?? null,
      expiresAt: session?.expires_at ?? null,
    }),
    [session],
  );

  const snapshot = {
    appVersion: getExpoAppVersion(),
    buildProfile: getBuildProfileLabel(),
    nativeBuild: getNativeBuildLabel(),
    executionEnvironment: getExecutionEnvironment(),
    previewOrDevClientProfile: isPreviewOrDevClientProfile(),
    ...getAppExtra(),
    tabModeReady: tabReady,
    tabMode: mode,
    language: i18n.language,
    supabaseConfigured: isSupabaseConfigured(),
    publicEnv: getPublicEnvSnapshot(),
    auth: authSnap,
  };

  const text = JSON.stringify(snapshot, null, 2);
  const isDevVariant = isAiStudioDevAppVariant();
  const canOpenAiStudio = canLoadAiDealStudioDevRoutes();

  return (
    <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal }}>
      {isDevVariant ? (
        <View
          style={{
            alignSelf: "flex-start",
            marginBottom: Spacing.sm,
            paddingHorizontal: Spacing.sm,
            paddingVertical: 4,
            borderRadius: 6,
            backgroundColor: "#111827",
          }}
        >
          <Text style={{ color: "#FBBF24", fontSize: 12, fontWeight: "800" }}>DEV</Text>
        </View>
      ) : null}
      {canOpenAiStudio ? (
        <Pressable
          onPress={() => router.push("/ai-deal-studio-dev" as Href)}
          style={{
            alignSelf: "flex-start",
            marginBottom: Spacing.sm,
            minHeight: 40,
            borderRadius: 6,
            backgroundColor: "#0F766E",
            justifyContent: "center",
            paddingHorizontal: Spacing.md,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "800" }}>AI Deal Studio</Text>
        </Pressable>
      ) : null}
      <Text style={{ marginBottom: Spacing.sm, fontSize: 13, color: Gray[600] }}>
        Long-press the block below to copy (system selection).
      </Text>
      <ScrollView contentContainerStyle={{ paddingBottom: scrollBottom }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontFamily: "monospace", fontSize: 11, color: Gray[900] }} selectable>
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}
