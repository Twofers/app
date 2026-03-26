import { supabase } from "@/lib/supabase";

export type BusinessProfileAccess = {
  hasProfileRow: boolean;
  isComplete: boolean;
  profile: {
    id: string;
    name: string | null;
    address: string | null;
    category: string | null;
    setup_completed: boolean | null;
  } | null;
};

type RawProfileRow = {
  id: string;
  name: string | null;
  address: string | null;
  category: string | null;
  setup_completed: boolean | null;
};

function isCompleteProfile(row: RawProfileRow | null): boolean {
  if (!row) return false;
  if (row.setup_completed === true) return true;
  return Boolean(row.name?.trim() && row.address?.trim());
}

export async function getBusinessProfileAccessForCurrentUser(): Promise<BusinessProfileAccess> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) {
    return { hasProfileRow: false, isComplete: false, profile: null };
  }

  const columns = "id,name,address,category,setup_completed";
  const byUserId = await supabase.from("business_profiles").select(columns).eq("user_id", uid).single();

  if (!byUserId.error || byUserId.error.code === "PGRST116") {
    const profile = (byUserId.data ?? null) as RawProfileRow | null;
    return {
      hasProfileRow: Boolean(profile),
      isComplete: isCompleteProfile(profile),
      profile: profile
        ? {
            id: profile.id,
            name: profile.name ?? null,
            address: profile.address ?? null,
            category: profile.category ?? null,
            setup_completed: profile.setup_completed ?? null,
          }
        : null,
    };
  }

  // Backward-compatible fallback for schemas using owner_id.
  const byOwnerId = await supabase.from("business_profiles").select(columns).eq("owner_id", uid).single();
  if (byOwnerId.error && byOwnerId.error.code !== "PGRST116") {
    return { hasProfileRow: false, isComplete: false, profile: null };
  }
  const profile = (byOwnerId.data ?? null) as RawProfileRow | null;
  return {
    hasProfileRow: Boolean(profile),
    isComplete: isCompleteProfile(profile),
    profile: profile
      ? {
          id: profile.id,
          name: profile.name ?? null,
          address: profile.address ?? null,
          category: profile.category ?? null,
          setup_completed: profile.setup_completed ?? null,
        }
      : null,
  };
}
