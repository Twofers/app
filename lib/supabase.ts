import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import Constants from "expo-constants";

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

const resolvedSupabaseUrl: string = supabaseUrl;
const resolvedSupabaseAnonKey: string = supabaseAnonKey;

type ObservabilityEventName =
  | "app_opened"
  | "signup_started"
  | "signup_completed"
  | "role_selected"
  | "shop_viewed"
  | "favorite_added"
  | "favorite_removed"
  | "alert_opt_in_accepted"
  | "alert_opt_in_declined"
  | "deal_redeemed"
  | "business_deal_created"
  | "app_error";

type AnalyticsPayload = {
  business_id?: string | null;
  deal_id?: string | null;
  claim_id?: string | null;
  context?: Record<string, string | number | boolean | null | undefined>;
  authorization?: string | null;
};

const ANALYTICS_FUNCTION_URL = `${resolvedSupabaseUrl}/functions/v1/ingest-analytics-event`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SENSITIVE_CONTEXT_KEY_RE = /(email|address|phone|token|secret|password|invite|qr|url|uri|lat|lng|latitude|longitude)/i;

const isWeb = Platform.OS === "web";
const hasWindow = typeof window !== "undefined";
const memory = new Map<string, string>();

function appVersion(): string | null {
  const constants = Constants as typeof Constants & { nativeAppVersion?: string };
  return Constants.expoConfig?.version ?? constants.nativeAppVersion ?? null;
}

function appBuild(): string | null {
  const constants = Constants as typeof Constants & { nativeBuildVersion?: string };
  const nativeBuild = constants.nativeBuildVersion;
  if (nativeBuild) return nativeBuild;
  if (Platform.OS === "android" && Constants.expoConfig?.android?.versionCode != null) {
    return String(Constants.expoConfig.android.versionCode);
  }
  if (Platform.OS === "ios" && Constants.expoConfig?.ios?.buildNumber) {
    return Constants.expoConfig.ios.buildNumber;
  }
  return null;
}

function cleanId(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function rowsFromBody(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body.filter(isRecord);
  return isRecord(body) ? [body] : [];
}

function sanitizeContext(input?: AnalyticsPayload["context"]): Record<string, string | number | boolean | null> {
  const base: Record<string, string | number | boolean | null> = {
    app_build: appBuild(),
    source: "supabase_observer",
  };
  if (!input) return base;
  for (const [key, value] of Object.entries(input).slice(0, 20)) {
    if (SENSITIVE_CONTEXT_KEY_RE.test(key)) continue;
    if (value == null || typeof value === "boolean" || typeof value === "number") {
      base[key] = value ?? null;
    } else if (typeof value === "string" && value.length <= 120 && !value.includes("@")) {
      base[key] = value;
    }
  }
  return base;
}

function sendObservabilityEvent(eventName: ObservabilityEventName, payload: AnalyticsPayload = {}): void {
  try {
    const authorization = payload.authorization?.trim() || `Bearer ${resolvedSupabaseAnonKey}`;
    void globalThis.fetch(ANALYTICS_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: resolvedSupabaseAnonKey,
        Authorization: authorization,
      },
      body: JSON.stringify({
        event_name: eventName,
        business_id: payload.business_id ?? null,
        deal_id: payload.deal_id ?? null,
        claim_id: payload.claim_id ?? null,
        context: sanitizeContext(payload.context),
        app_version: appVersion(),
        device_platform: Platform.OS,
      }),
    }).catch(() => {});
  } catch {
    /* best effort only */
  }
}

function hashText(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function errorContext(error: unknown, source: string, fatal?: boolean) {
  const err = error instanceof Error ? error : null;
  const name = err?.name ?? typeof error;
  const message = err?.message ?? String(error ?? "");
  const stackHead = err?.stack?.split("\n").slice(0, 3).join("\n") ?? "";
  return {
    source,
    fatal: Boolean(fatal),
    error_name: String(name).slice(0, 80),
    error_hash: hashText(`${name}:${message}:${stackHead}`),
  };
}

function installObservability(): void {
  const globalWithErrors = globalThis as typeof globalThis & {
    ErrorUtils?: {
      getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
      setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
    };
  };
  sendObservabilityEvent("app_opened", { context: { source: "app_start" } });
  const previousHandler = globalWithErrors.ErrorUtils?.getGlobalHandler?.();
  if (globalWithErrors.ErrorUtils?.setGlobalHandler) {
    globalWithErrors.ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      sendObservabilityEvent("app_error", { context: errorContext(error, "ErrorUtils", isFatal) });
      if (previousHandler) {
        previousHandler(error, isFatal);
        return;
      }
      if (isFatal) {
        throw error instanceof Error ? error : new Error(String(error ?? "Fatal app error"));
      }
    });
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  const url = (input as { url?: unknown }).url;
  return typeof url === "string" ? url : String(input);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const method = init?.method ?? (input as { method?: unknown }).method;
  return typeof method === "string" ? method.toUpperCase() : "GET";
}

function headerValue(headers: unknown, name: string): string | null {
  if (!headers) return null;
  const getter = (headers as { get?: (key: string) => string | null }).get;
  if (typeof getter === "function") return getter.call(headers, name) ?? getter.call(headers, name.toLowerCase());
  if (Array.isArray(headers)) {
    const found = headers.find((item) => Array.isArray(item) && String(item[0]).toLowerCase() === name.toLowerCase());
    return found ? String(found[1]) : null;
  }
  if (typeof headers === "object") {
    const record = headers as Record<string, unknown>;
    const key = Object.keys(record).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? String(record[key]) : null;
  }
  return null;
}

function requestAuthorization(input: RequestInfo | URL, init?: RequestInit): string | null {
  return headerValue(init?.headers, "Authorization") ?? headerValue((input as { headers?: unknown }).headers, "Authorization");
}

function requestBodyJson(init?: RequestInit): unknown {
  const body = init?.body;
  if (typeof body !== "string") return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function queryEq(url: URL, key: string): string | null {
  const value = url.searchParams.get(key);
  return value?.startsWith("eq.") ? value.slice(3) : null;
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return (await response.clone().json()) as unknown;
  } catch {
    return null;
  }
}

function observeBeforeRequest(urlText: string, method: string, authorization: string | null): void {
  try {
    const url = new URL(urlText);
    if (method === "POST" && url.pathname.endsWith("/auth/v1/signup")) {
      sendObservabilityEvent("signup_started", { authorization, context: { source: "auth_signup" } });
    }
  } catch {
    /* ignore malformed URLs */
  }
}

async function observeSuccessfulResponse(
  urlText: string,
  method: string,
  requestBody: unknown,
  authorization: string | null,
  response: Response,
): Promise<void> {
  if (!response.ok) return;
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    return;
  }

  const path = url.pathname;
  if (method === "POST" && path.endsWith("/auth/v1/signup")) {
    sendObservabilityEvent("signup_completed", { authorization, context: { source: "auth_signup" } });
    return;
  }

  if (method === "GET" && path.endsWith("/rest/v1/businesses")) {
    const businessId = cleanId(queryEq(url, "id"));
    if (businessId) {
      sendObservabilityEvent("shop_viewed", { authorization, business_id: businessId, context: { source: "business_detail" } });
    }
    return;
  }

  if ((method === "POST" || method === "PATCH") && path.endsWith("/rest/v1/profiles")) {
    for (const row of rowsFromBody(requestBody)) {
      const role = row.role;
      if (role === "customer" || role === "business") {
        sendObservabilityEvent("role_selected", { authorization, context: { role } });
      }
    }
    return;
  }

  if (method === "POST" && path.endsWith("/rest/v1/favorites")) {
    for (const row of rowsFromBody(requestBody).slice(0, 20)) {
      const businessId = cleanId(row.business_id);
      sendObservabilityEvent("favorite_added", { authorization, business_id: businessId, context: { source: "favorites_insert" } });
    }
    return;
  }

  if (method === "DELETE" && path.endsWith("/rest/v1/favorites")) {
    sendObservabilityEvent("favorite_removed", {
      authorization,
      business_id: cleanId(queryEq(url, "business_id")),
      context: { source: "favorites_delete" },
    });
    return;
  }

  if ((method === "POST" || method === "PATCH") && path.endsWith("/rest/v1/consumer_profiles")) {
    const rows = rowsFromBody(requestBody);
    if (rows.length === 1 && Object.keys(rows[0]!).length === 1 && typeof rows[0]!.deal_alerts_enabled === "boolean") {
      sendObservabilityEvent(rows[0]!.deal_alerts_enabled ? "alert_opt_in_accepted" : "alert_opt_in_declined", {
        authorization,
        context: { source: "alerts_toggle" },
      });
    }
    return;
  }

  if (method === "POST" && path.endsWith("/rest/v1/deals")) {
    const bodyRows = rowsFromBody(requestBody);
    const returnedRows = rowsFromBody(await responseJson(response));
    const max = Math.max(bodyRows.length, returnedRows.length, 1);
    for (let i = 0; i < max; i += 1) {
      const bodyRow = bodyRows[i] ?? bodyRows[0] ?? {};
      const returnedRow = returnedRows[i] ?? {};
      sendObservabilityEvent("business_deal_created", {
        authorization,
        business_id: cleanId(bodyRow.business_id),
        deal_id: cleanId(returnedRow.id),
        context: { source: "deals_insert" },
      });
    }
    return;
  }

  if (method === "POST" && (path.endsWith("/functions/v1/redeem-token") || path.endsWith("/functions/v1/complete-visual-redeem"))) {
    const returned = await responseJson(response);
    const returnedRow = isRecord(returned) ? returned : {};
    if (returnedRow.ok === false) return;
    const requestRow = isRecord(requestBody) ? requestBody : {};
    sendObservabilityEvent("deal_redeemed", {
      authorization,
      claim_id: cleanId(returnedRow.claim_id) ?? cleanId(requestRow.claim_id),
      deal_id: cleanId(returnedRow.deal_id),
      context: { method: path.endsWith("/redeem-token") ? "qr" : "visual" },
    });
  }
}

installObservability();

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
  const url = requestUrl(input);
  const method = requestMethod(input, init);
  const authorization = requestAuthorization(input, init);
  const body = requestBodyJson(init);
  observeBeforeRequest(url, method, authorization);
  return run(input, init).then((response) => {
    void observeSuccessfulResponse(url, method, body, authorization, response.clone()).catch(() => {});
    return response;
  }).catch((err: unknown) => {
    if (__DEV__) console.warn("[supabaseFetch] Network error:", err);
    throw new Error("Network request failed. Check your connection and try again.");
  });
}

export const supabase = createClient(resolvedSupabaseUrl, resolvedSupabaseAnonKey, {
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
