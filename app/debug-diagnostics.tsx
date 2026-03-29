import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useScreenInsets, Spacing } from "@/lib/screen-layout";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { useTabMode } from "@/lib/tab-mode";
import {
  getAppExtra,
  getBuildProfileLabel,
  getExpoAppVersion,
  getExecutionEnvironment,
  getNativeBuildLabel,
  getPublicEnvSnapshot,
  isDemoAuthHelperEnabled,
  isPreviewOrDevClientProfile,
  isSupabaseConfigured,
} from "@/lib/runtime-env";

export default function DebugDiagnosticsScreen() {
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
    demoAuthHelper: isDemoAuthHelperEnabled(),
    supabaseConfigured: isSupabaseConfigured(),
    publicEnv: getPublicEnvSnapshot(),
    auth: authSnap,
  };

  const text = JSON.stringify(snapshot, null, 2);

  return (
    <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal }}>
      <Text style={{ marginBottom: Spacing.sm, fontSize: 13, color: "#555" }}>
        Long-press the block below to copy (system selection).
      </Text>
      <ScrollView contentContainerStyle={{ paddingBottom: scrollBottom }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontFamily: "monospace", fontSize: 11, color: "#111" }} selectable>
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}
