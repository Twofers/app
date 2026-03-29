import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { useTabMode } from "@/lib/tab-mode";
import { devLog } from "@/lib/dev-log";
import {
  getAppExtra,
  getBuildProfileLabel,
  getExpoAppVersion,
  getExecutionEnvironment,
  getNativeBuildLabel,
  getPublicEnvSnapshot,
  isDebugBootLogEnabled,
  isPreviewOrDevClientProfile,
} from "@/lib/runtime-env";

/**
 * Logs a one-shot snapshot to Metro / Logcat when enabled (dev or EXPO_PUBLIC_DEBUG_BOOT_LOG).
 */
export function DiagnosticBootLog() {
  const { ready, mode } = useTabMode();
  const { i18n } = useTranslation();
  const { session, isInitialLoading: authLoading } = useAuthSession();
  const didLog = useRef(false);

  useEffect(() => {
    if (!isDebugBootLogEnabled() || !ready || authLoading || didLog.current) return;
    didLog.current = true;
    const language = i18n.language;
    const tabMode = mode;
    const payload = {
      version: getExpoAppVersion(),
      buildProfile: getBuildProfileLabel(),
      nativeBuild: getNativeBuildLabel(),
      executionEnvironment: getExecutionEnvironment(),
      previewOrDevClientProfile: isPreviewOrDevClientProfile(),
      ...getAppExtra(),
      tabMode,
      language,
      authUserId: session?.user?.id ?? null,
      authEmail: session?.user?.email ?? null,
      publicEnv: getPublicEnvSnapshot(),
    };
    devLog("[twoforone:boot]", JSON.stringify(payload, null, 2));
  }, [ready, mode, i18n.language, session?.user?.id, session?.user?.email, authLoading]);

  return null;
}
