import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { useRouter } from "expo-router";

/**
 * Target for `emailRedirectTo` (see `getEmailAuthRedirectUrl`).
 * Supabase appends tokens or `code` to this URL; `AuthRecoveryLinkHandler` consumes them.
 * We bounce to root so the auth gate can route into the app.
 */
export default function AuthCallbackScreen() {
  const router = useRouter();

  useEffect(() => {
    const id = setTimeout(() => {
      router.replace("/");
    }, 500);
    return () => clearTimeout(id);
  }, [router]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  );
}
