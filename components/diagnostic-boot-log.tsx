import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { useTabMode } from "@/lib/tab-mode";
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
  const didLog = useRef(false);

  useEffect(() => {
    if (!isDebugBootLogEnabled() || !ready || didLog.current) return;
    didLog.current = true;
    let cancelled = false;
    const language = i18n.language;
    const tabMode = mode;
    void (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (cancelled) return;
      const payload = {
        version: getExpoAppVersion(),
        buildProfile: getBuildProfileLabel(),
        nativeBuild: getNativeBuildLabel(),
        executionEnvironment: getExecutionEnvironment(),
        previewOrDevClientProfile: isPreviewOrDevClientProfile(),
        ...getAppExtra(),
        tabMode,
        language,
        authUserId: sessionData.session?.user?.id ?? null,
        authEmail: sessionData.session?.user?.email ?? null,
        publicEnv: getPublicEnvSnapshot(),
      };
      console.log("[twoforone:boot]", JSON.stringify(payload, null, 2));
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, mode, i18n.language]);

  return null;
}
