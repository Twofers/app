import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { isDemoAuthHelperEnabled } from "../../lib/runtime-env";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import { LegalExternalLinks } from "../../components/legal-external-links";

export default function AuthScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { top, horizontal, scrollBottom } = useScreenInsets("tab");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isBusinessOwner, setIsBusinessOwner] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSessionEmail(session?.user?.email ?? null);
      setUserId(session?.user?.id ?? null);
      if (session?.user?.id) {
        const { data } = await supabase
          .from("businesses")
          .select("id")
          .eq("owner_id", session.user.id)
          .single();
        setIsBusinessOwner(!!data);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, sess) => {
      setSessionEmail(sess?.user?.email ?? null);
      setUserId(sess?.user?.id ?? null);
      if (sess?.user?.id) {
        const { data } = await supabase
          .from("businesses")
          .select("id")
          .eq("owner_id", sess.user.id)
          .single();
        setIsBusinessOwner(!!data);
      } else {
        setIsBusinessOwner(false);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function signUp() {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password: pw,
      });
      if (error) throw error;
      Alert.alert(t("auth.alertSignUpSuccessTitle"), t("auth.alertSignUpSuccessMsg"));
    } catch (e: any) {
      Alert.alert(t("auth.alertSignUpFailTitle"), e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function signIn(overrideEmail?: string, overridePw?: string) {
    setBusy(true);
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
        const msg = String(error.message || "");
        const canAutoSignUp =
          isDemoAuthHelperEnabled() &&
          isDemo &&
          (msg.includes("Invalid login credentials") ||
            msg.toLowerCase().includes("user not found"));

        if (canAutoSignUp) {
          const { error: signUpError } = await supabase.auth.signUp({
            email: demoEmail,
            password: demoPassword,
          });
          if (signUpError) {
            throw signUpError;
          }

          const { error: retryError } = await supabase.auth.signInWithPassword({
            email: demoEmail,
            password: demoPassword,
          });
          if (retryError) throw retryError;
        } else {
          throw error;
        }
      }

      Alert.alert("Logged in", "You’re in.");
    } catch (e: any) {
      Alert.alert("Login failed", e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("auth.title")}</Text>

      <ScrollView
        style={{ flex: 1, marginTop: Spacing.lg }}
        contentContainerStyle={{ paddingBottom: scrollBottom }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
      <Text style={{ marginTop: 0 }}>{t("auth.email")}</Text>
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

      <Text style={{ marginTop: 12 }}>{t("auth.password")}</Text>
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

      <Pressable
        onPress={() => router.push("/forgot-password" as Href)}
        style={{ alignSelf: "flex-start", marginTop: 10, paddingVertical: 4 }}
      >
        <Text style={{ fontSize: 15, fontWeight: "600", color: "#2563eb" }}>{t("passwordRecovery.forgotLink")}</Text>
      </Pressable>

      <Pressable
        disabled={busy}
        onPress={() => void signIn()}
        style={{
          marginTop: 18,
          padding: 14,
          borderRadius: 12,
          backgroundColor: "#111",
        }}
      >
        <Text style={{ color: "white", fontWeight: "700", textAlign: "center" }}>{t("auth.logIn")}</Text>
      </Pressable>

      <Pressable
        disabled={busy}
        onPress={signUp}
        style={{
          marginTop: 12,
          padding: 14,
          borderRadius: 12,
          backgroundColor: "#2b6cb0",
        }}
      >
        <Text style={{ color: "white", fontWeight: "700", textAlign: "center" }}>{t("auth.signUp")}</Text>
      </Pressable>

      {isDemoAuthHelperEnabled() ? (
        <Pressable
          disabled={busy}
          onPress={async () => {
            await signIn("demo@demo.com", "demo12345");
          }}
          style={{
            marginTop: 12,
            padding: 14,
            borderRadius: 12,
            backgroundColor: "#111",
            opacity: busy ? 0.7 : 1,
          }}
        >
          <Text style={{ color: "white", fontWeight: "700", textAlign: "center" }}>{t("auth.demoLogin")}</Text>
        </Pressable>
      ) : null}

      <View style={{ marginTop: Spacing.lg, gap: Spacing.sm }}>
        <Text style={{ fontSize: 13, lineHeight: 18, opacity: 0.68, textAlign: "center" }}>{t("legal.authFooterHint")}</Text>
        <LegalExternalLinks align="center" />
      </View>

      {sessionEmail && !isBusinessOwner ? (
        <View style={{ marginTop: 24 }}>
          <Text style={{ fontWeight: "700", fontSize: 16 }}>{t("auth.createBusinessHeader")}</Text>
          <Text style={{ marginTop: 6, opacity: 0.8 }}>{t("auth.createBusinessBody")}</Text>
          <Pressable
            onPress={() => {
              if (!userId) {
                Alert.alert(t("auth.alertLoginRequiredTitle"), t("auth.alertLoginRequiredMsg"));
                return;
              }
              router.push("/business-setup" as Href);
            }}
            style={{
              padding: 12,
              borderRadius: 12,
              backgroundColor: "#111",
              marginTop: 12,
            }}
          >
            <Text style={{ color: "white", fontWeight: "700", textAlign: "center" }}>
              {t("account.startBusinessSetup")}
            </Text>
          </Pressable>
        </View>
      ) : null}
      </ScrollView>
    </View>
  );
}
