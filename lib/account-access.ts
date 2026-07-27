import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

export type AccountStatus = "active" | "suspended" | "archived";

export function isAccountAccessBlocked(status: unknown): boolean {
  return status === "suspended" || status === "archived";
}

/**
 * Auth banning blocks new sessions. This profile check also drops a cached
 * mobile session when the app starts or Auth refreshes.
 *
 * A missing column/table is treated as active for migration-order
 * compatibility; the Auth ban remains the login authority.
 */
export async function keepSessionForActiveAccount(session: Session | null): Promise<Session | null> {
  if (!session?.user?.id) return session;
  const { data, error } = await supabase
    .from("profiles")
    .select("account_status")
    .eq("id", session.user.id)
    .maybeSingle();
  if (error || !isAccountAccessBlocked(data?.account_status)) return session;
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});
  return null;
}
