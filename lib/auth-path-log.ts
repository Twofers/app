import { isDebugBootLogEnabled } from "@/lib/runtime-env";

export type AuthPath =
  | "normal_login"
  | "signup"
  | "forgot_password"
  | "demo_login"
  | "session_restore";

export function logAuthPath(path: AuthPath, detail?: string): void {
  if (!__DEV__ && !isDebugBootLogEnabled()) return;
  const msg = detail ? `[auth] ${path} — ${detail}` : `[auth] ${path}`;
  console.log(msg);
}
