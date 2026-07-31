import { isDebugBootLogEnabled } from "@/lib/runtime-env";

export type AuthPath =
  | "normal_login"
  | "signup"
  | "forgot_password"
  | "session_restore"
  | "google_signin"
  | "apple_signin"
  | "social_finish_setup";

export function logAuthPath(path: AuthPath, detail?: string): void {
  if (!__DEV__ && !isDebugBootLogEnabled()) return;
  const msg = detail ? `[auth] ${path} — ${detail}` : `[auth] ${path}`;
  console.log(msg);
}
