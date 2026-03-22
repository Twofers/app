import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type BusinessInfo = {
  id: string;
  name: string;
};

export function useBusiness() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [business, setBusiness] = useState<BusinessInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) {
      setIsLoggedIn(false);
      setUserId(null);
      setSessionEmail(null);
      setBusiness(null);
      setLoading(false);
      return;
    }

    setIsLoggedIn(true);
    setUserId(session.user.id);
    setSessionEmail(session.user.email ?? null);

    const { data } = await supabase
      .from("businesses")
      .select("id,name")
      .eq("owner_id", session.user.id)
      .single();
    setBusiness(data ? { id: data.id, name: data.name } : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      refresh();
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  return {
    isLoggedIn,
    userId,
    sessionEmail,
    businessId: business?.id ?? null,
    businessName: business?.name ?? null,
    loading,
    refresh,
  };
}
