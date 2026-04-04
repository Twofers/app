import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

/** Inlined at bundle time — set the same keys in EAS for `preview` and `production` environment scopes. */
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

const isWeb = Platform.OS === "web";
const hasWindow = typeof window !== "undefined";
const memory = new Map<string, string>();

async function getNativeSecureStore() {
  const mod = await import("expo-secure-store");
  return mod;
}

const StorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    if (isWeb) {
      if (!hasWindow) return memory.get(key) ?? null;
      try {
        return window.localStorage.getItem(key);
      } catch (err) {
        if (__DEV__) console.warn("[StorageAdapter] getItem fallback:", err);
        return memory.get(key) ?? null;
      }
    }
    const SecureStore = await getNativeSecureStore();
    return SecureStore.getItemAsync(key);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (isWeb) {
      if (!hasWindow) {
        memory.set(key, value);
        return;
      }
      try {
        window.localStorage.setItem(key, value);
      } catch (err) {
        if (__DEV__) console.warn("[StorageAdapter] setItem fallback:", err);
        memory.set(key, value);
      }
      return;
    }
    const SecureStore = await getNativeSecureStore();
    await SecureStore.setItemAsync(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    if (isWeb) {
      if (!hasWindow) {
        memory.delete(key);
        return;
      }
      try {
        window.localStorage.removeItem(key);
      } catch (err) {
        if (__DEV__) console.warn("[StorageAdapter] removeItem fallback:", err);
        memory.delete(key);
      }
      return;
    }
    const SecureStore = await getNativeSecureStore();
    await SecureStore.deleteItemAsync(key);
  },
};

/** Catches RN fetch polyfill crashes and network failures so Supabase.js never tries to JSON.parse an empty body. */
function supabaseFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const run = globalThis.fetch.bind(globalThis);
  return run(input, init).catch((err: unknown) => {
    if (__DEV__) console.warn("[supabaseFetch] Network error:", err);
    throw new Error("Network request failed. Check your connection and try again.");
  });
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: StorageAdapter,
    autoRefreshToken: true,
    // SSR on web has no real storage; keep it purely client-side.
    persistSession: !isWeb || hasWindow,
    detectSessionInUrl: false,
  },
  global: {
    fetch: supabaseFetch,
  },
});
