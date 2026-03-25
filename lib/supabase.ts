import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

if (!supabaseUrl || !supabaseAnonKey) {
  const missing: string[] = [];
  if (!supabaseUrl) missing.push("EXPO_PUBLIC_SUPABASE_URL");
  if (!supabaseAnonKey) missing.push("EXPO_PUBLIC_SUPABASE_ANON_KEY");
  throw new Error(
    `[twoforone] Supabase is not configured: missing ${missing.join(" and ")}. ` +
      "For local runs, set them in `.env` or `.env.local` (see `.env.example`). " +
      "For EAS builds, add both as project Environment variables for the build’s environment " +
      '(expo.dev → project → Environment variables: use "preview" for the `preview` profile and "production" for `production` in eas.json), then rebuild.'
  );
}

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
