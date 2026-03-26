import { DEMO_PREVIEW_EMAIL, DEMO_PREVIEW_PASSWORD } from "@/lib/demo-account";
import { ensureDemoCoffeePreview } from "@/lib/demo-preview-seed";
import { supabase } from "@/lib/supabase";

export type DemoSignInResult = { ok: true } | { ok: false; message: string };

/**
 * Preview/dev demo account: password sign-in only (no sign-up / no email OTP).
 * Call after `isDemoAuthHelperEnabled()` is true.
 */
export async function signInDemoPreviewUser(): Promise<DemoSignInResult> {
  const { error } = await supabase.auth.signInWithPassword({
    email: DEMO_PREVIEW_EMAIL,
    password: DEMO_PREVIEW_PASSWORD,
  });
  if (error) {
    return { ok: false, message: error.message ?? "Login failed" };
  }
  await ensureDemoCoffeePreview(supabase);
  return { ok: true };
}
