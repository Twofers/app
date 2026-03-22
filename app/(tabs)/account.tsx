import { useEffect, useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { supabase } from "../../lib/supabase";
import { getAlertsEnabled, setAlertsEnabled } from "../../lib/notifications";
import { useBusiness } from "../../hooks/use-business";
import { Banner } from "../../components/ui/banner";
import { PrimaryButton } from "../../components/ui/primary-button";
import { SecondaryButton } from "../../components/ui/secondary-button";

export default function AccountScreen() {
  const router = useRouter();
  const { isLoggedIn, sessionEmail, businessId, loading, refresh } = useBusiness();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ message: string; tone?: "error" | "success" | "info" } | null>(null);
  const [alertsEnabled, setAlertsEnabledState] = useState(false);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [businessName, setBusinessName] = useState("");
  const [creatingBusiness, setCreatingBusiness] = useState(false);

  useEffect(() => {
    (async () => {
      const enabled = await getAlertsEnabled();
      setAlertsEnabledState(enabled);
      setAlertsLoading(false);
    })();
  }, []);

  async function toggleAlerts(next: boolean) {
    if (next) {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== "granted") {
        setBanner({ message: "Enable notifications to receive deal alerts.", tone: "info" });
        return;
      }
    }
    await setAlertsEnabled(next);
    setAlertsEnabledState(next);
    setBanner({ message: next ? "Deal alerts enabled." : "Deal alerts disabled.", tone: "success" });
  }

  async function signUp() {
    setBusy(true);
    setBanner(null);
    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password: pw,
      });
      if (error) throw error;
      setBanner({ message: "Check your email to confirm, then log in.", tone: "success" });
    } catch (e: any) {
      setBanner({ message: e?.message ?? "Sign up failed.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function signIn(overrideEmail?: string, overridePw?: string) {
    setBusy(true);
    setBanner(null);
    try {
      const demoEmail = "demo@demo.com";
      const demoPassword = "demo12345";
      const emailToUse = (overrideEmail ?? email).trim();
      const pwToUse = overridePw ?? pw;
      const isDemo = emailToUse.toLowerCase() === demoEmail;

      const { error } = await supabase.auth.signInWithPassword({
        email: emailToUse,
        password: pwToUse,
      });

      if (error) {
        const isDev = process.env.NODE_ENV !== "production";
        const msg = String(error.message || "");
        const canAutoSignUp =
          isDev &&
          isDemo &&
          (msg.includes("Invalid login credentials") || msg.toLowerCase().includes("user not found"));

        if (canAutoSignUp) {
          const { error: signUpError } = await supabase.auth.signUp({
            email: demoEmail,
            password: demoPassword,
          });
          if (signUpError) throw signUpError;

          const { error: retryError } = await supabase.auth.signInWithPassword({
            email: demoEmail,
            password: demoPassword,
          });
          if (retryError) throw retryError;
        } else {
          throw error;
        }
      }

      await refresh();
      if (isDemo) {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (userId) {
          const { data } = await supabase
            .from("businesses")
            .select("id")
            .eq("owner_id", userId)
            .maybeSingle();
          if (!data) {
          await supabase.from("businesses").insert({ owner_id: userId, name: "Demo Cafe" });
          }
        }
        await refresh();
      }
      setBanner({ message: "You're logged in.", tone: "success" });
    } catch (e: any) {
      setBanner({ message: e?.message ?? "Login failed.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setBanner(null);
    try {
      await supabase.auth.signOut();
      setBanner({ message: "Logged out.", tone: "info" });
    } catch (e: any) {
      setBanner({ message: e?.message ?? "Logout failed.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function createBusiness() {
    if (!sessionEmail) {
      setBanner({ message: "Please log in to create a business.", tone: "error" });
      return;
    }
    const name = businessName.trim();
    if (!name) {
      setBanner({ message: "Business name required.", tone: "error" });
      return;
    }
    setCreatingBusiness(true);
    setBanner(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) throw new Error("Missing user session.");
      const { error } = await supabase.from("businesses").insert({ owner_id: userId, name });
      if (error) throw error;
      setBusinessName("");
      await refresh();
      setBanner({ message: "Business created.", tone: "success" });
    } catch (e: any) {
      setBanner({ message: e?.message ?? "Create business failed.", tone: "error" });
    } finally {
      setCreatingBusiness(false);
    }
  }

  return (
    <View style={{ paddingTop: 70, paddingHorizontal: 16, flex: 1 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Account</Text>
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      {!isLoggedIn ? (
        <View style={{ marginTop: 16, gap: 12 }}>
          <View>
            <Text>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              style={{
                borderWidth: 1,
                borderColor: "#ccc",
                borderRadius: 10,
                padding: 12,
                marginTop: 6,
              }}
            />
          </View>

          <View>
            <Text>Password</Text>
            <TextInput
              value={pw}
              onChangeText={setPw}
              secureTextEntry
              style={{
                borderWidth: 1,
                borderColor: "#ccc",
                borderRadius: 10,
                padding: 12,
                marginTop: 6,
              }}
            />
          </View>

          <PrimaryButton title={busy ? "Logging in..." : "Log in"} onPress={() => signIn()} disabled={busy} />
          <SecondaryButton title="Sign up" onPress={signUp} disabled={busy} />
          <PrimaryButton title="Demo Login" onPress={() => signIn("demo@demo.com", "demo12345")} disabled={busy} />
        </View>
      ) : (
        <View style={{ marginTop: 16, gap: 12 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <PrimaryButton title="Customer mode" onPress={() => router.replace("/(tabs)")} />
            <SecondaryButton title="Business mode" onPress={() => router.replace("/(tabs)/create")} />
          </View>
          <View>
            <Text style={{ opacity: 0.7 }}>Logged in as</Text>
            <Text style={{ fontWeight: "700", marginTop: 4 }}>{sessionEmail}</Text>
          </View>

          <View
            style={{
              borderWidth: 1,
              borderColor: "#eee",
              borderRadius: 12,
              padding: 12,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <View>
              <Text style={{ fontWeight: "700" }}>Deal alerts</Text>
              <Text style={{ opacity: 0.7, marginTop: 4 }}>Notify me when favorites post new deals.</Text>
            </View>
            <Switch value={alertsEnabled} onValueChange={toggleAlerts} disabled={alertsLoading} />
          </View>

          {businessId ? (
            <PrimaryButton title="Business Dashboard" onPress={() => router.push("/dashboard")} />
          ) : (
            <View
              style={{
                backgroundColor: "#f8f8f8",
                borderRadius: 12,
                padding: 12,
              }}
            >
              <Text style={{ fontWeight: "700" }}>Create business</Text>
              <Text style={{ marginTop: 6, opacity: 0.7 }}>
                Create a business to post deals and redeem QR codes.
              </Text>
              <TextInput
                value={businessName}
                onChangeText={setBusinessName}
                placeholder="Business name"
                autoCapitalize="words"
                style={{
                  borderWidth: 1,
                  borderColor: "#ccc",
                  borderRadius: 10,
                  padding: 12,
                  marginTop: 10,
                }}
              />
              <View style={{ marginTop: 10 }}>
                <PrimaryButton
                  title={creatingBusiness ? "Creating..." : "Create Business"}
                  onPress={createBusiness}
                  disabled={creatingBusiness}
                />
              </View>
            </View>
          )}

          <Pressable
            onPress={signOut}
            disabled={busy || loading}
            style={{
              paddingVertical: 12,
              borderRadius: 12,
              backgroundColor: "#eee",
              opacity: busy || loading ? 0.7 : 1,
            }}
          >
            <Text style={{ color: "#111", fontWeight: "700", textAlign: "center" }}>Log out</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
