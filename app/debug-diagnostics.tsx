import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { useTranslation } from "react-i18next";
import { Gray } from "@/constants/theme";
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
  isPreviewOrDevClientProfile,
  isSupabaseConfigured,
} from "@/lib/runtime-env";

function DebugDiagnosticsContent() {
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { i18n } = useTranslation();
  const { session } = useAuthSession();
  const { mode, ready: tabReady } = useTabMode();
  const authSnap = useMemo(
    () => ({
      error: null as string | null,
      userId: redactDiagnosticValue(session?.user?.id ?? null),
      email: redactEmail(session?.user?.email ?? null),
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
    publicEnv: Object.fromEntries(
      Object.entries(getPublicEnvSnapshot()).map(([key, value]) => [key, redactDiagnosticValue(value)]),
    ),
    auth: authSnap,
  };

  const text = JSON.stringify(snapshot, null, 2);

  return (
    <View style={{ flex: 1, paddingTop: top, paddingHorizontal: horizontal }}>
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

export default function DebugDiagnosticsScreen() {
  if (!__DEV__) {
    return <Redirect href="/(tabs)" />;
  }
  return <DebugDiagnosticsContent />;
}

function redactEmail(value: string | null): string | null {
  if (!value) return null;
  const [name, domain] = value.split("@");
  if (!name || !domain) return "(redacted email)";
  return `${name.slice(0, 2)}***@${domain.replace(/^[^.]+/, "***")}`;
}

function redactDiagnosticValue(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value);
  if (!text || text === "(unset)" || text === "(missing)" || text === "unknown") return text;
  if (/^set(?:\s|\()/i.test(text)) return "set";
  if (/https?:\/\//i.test(text) || text.includes(".supabase.co")) return "(redacted URL)";
  if (/^[0-9a-f-]{24,}$/i.test(text)) return `${text.slice(0, 8)}...`;
  return text;
}
