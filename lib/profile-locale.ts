import type { AppLocale } from "@/lib/i18n/config";
import { devWarn } from "@/lib/dev-log";
import { supabase } from "@/lib/supabase";

/**
 * Best-effort server mirror of the app language. Push notifications and other
 * server-rendered copy cannot read AsyncStorage, so they use profiles.app_locale.
 */
export async function syncAppLocaleToServer(
  userId: string | null | undefined,
  locale: AppLocale,
): Promise<void> {
  if (!userId) return;

  try {
    const { error } = await supabase.from("profiles").upsert(
      {
        id: userId,
        app_locale: locale,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) devWarn("[profile-locale] sync failed:", error.message);
  } catch (err) {
    devWarn("[profile-locale] sync exception:", err);
  }
}
