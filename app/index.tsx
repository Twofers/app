import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { supabase } from "../lib/supabase";

export default function Index() {
  const [status, setStatus] = useState("Checking Supabase...");

  useEffect(() => {
    (async () => {
      try {
        const { error } = await supabase.from("deals").select("id").limit(1);
        if (error) throw error;
        setStatus("Connected ✅ Supabase is working");
      } catch (e: any) {
        setStatus(`Not connected ❌ ${e?.message ?? String(e)}`);
      }
    })();
  }, []);

  return (
    <View style={{ paddingTop: 80, paddingHorizontal: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>TwoForOne</Text>
      <Text style={{ marginTop: 12 }}>{status}</Text>
    </View>
  );
}
