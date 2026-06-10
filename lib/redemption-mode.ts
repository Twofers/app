import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Session } from "@supabase/supabase-js";
import { Platform } from "react-native";
import { EDGE_FUNCTION_TIMEOUT_MS, parseFunctionError } from "./functions";
import { isRedeemerSessionLike, normalizeRedemptionCode } from "./redemption-mode-logic";
import { supabase } from "./supabase";

export const REDEMPTION_MODE_STATE_KEY = "twofer_redemption_mode_state_v1";
const INSTALL_ID_KEY = "twofer_redemption_install_id_v1";
const OWNER_SESSION_BACKUP_KEY = "twofer_redemption_owner_session_v1";
const STAFF_SESSION_BACKUP_KEY = "twofer_redemption_staff_session_v1";
const EXIT_TOKEN_KEY = "twofer_redemption_exit_token_v1";

const memorySecureStore = new Map<string, string>();

export type RedemptionModeState = {
  active: true;
  businessId: string;
  deviceId: string;
  installId: string;
  deviceLabel: string;
  activatedAt: string | null;
};

export type RedemptionDeviceSummary = {
  id: string;
  business_id: string;
  device_label: string;
  active: boolean;
  activated_at: string | null;
  deactivated_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

export type StaffRedemptionResult = {
  ok: boolean;
  status: string;
  message: string;
  claim_id?: string | null;
  deal_id?: string | null;
  business_id?: string | null;
  deal_title?: string | null;
  customer_first_name?: string | null;
  redeem_by?: string | null;
  redeemed_at?: string | null;
  device_label?: string | null;
};

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

async function secureGetItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    if (!hasWindow()) return memorySecureStore.get(key) ?? null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return memorySecureStore.get(key) ?? null;
    }
  }
  const SecureStore = await import("expo-secure-store");
  return SecureStore.getItemAsync(key);
}

async function secureSetItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    if (!hasWindow()) {
      memorySecureStore.set(key, value);
      return;
    }
    try {
      window.localStorage.setItem(key, value);
    } catch {
      memorySecureStore.set(key, value);
    }
    return;
  }
  const SecureStore = await import("expo-secure-store");
  await SecureStore.setItemAsync(key, value);
}

async function secureDeleteItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    memorySecureStore.delete(key);
    if (hasWindow()) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* noop */
      }
    }
    return;
  }
  const SecureStore = await import("expo-secure-store");
  await SecureStore.deleteItemAsync(key);
}

function safeParseSession(value: string | null): Session | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<Session>;
    if (typeof parsed.access_token === "string" && typeof parsed.refresh_token === "string") {
      return parsed as Session;
    }
  } catch {
    /* noop */
  }
  return null;
}

function safeParseState(value: string | null): RedemptionModeState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<RedemptionModeState>;
    if (
      parsed.active === true &&
      typeof parsed.businessId === "string" &&
      typeof parsed.deviceId === "string" &&
      typeof parsed.installId === "string" &&
      typeof parsed.deviceLabel === "string"
    ) {
      return {
        active: true,
        businessId: parsed.businessId,
        deviceId: parsed.deviceId,
        installId: parsed.installId,
        deviceLabel: parsed.deviceLabel,
        activatedAt: typeof parsed.activatedAt === "string" ? parsed.activatedAt : null,
      };
    }
  } catch {
    /* noop */
  }
  return null;
}

function randomInstallId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") return randomUUID.call(globalThis.crypto);
  const part = () => Math.floor((1 + Math.random()) * 0x100000000).toString(16).slice(1);
  return `${part()}${part()}-${part()}-${part()}-${part()}-${part()}${part()}${part()}`;
}

async function invokeErrorMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (typeof Response !== "undefined" && ctx instanceof Response) {
    try {
      const body = await ctx.clone().json();
      if (body && typeof body === "object") {
        const message = (body as { error?: unknown; message?: unknown }).error ?? (body as { message?: unknown }).message;
        if (typeof message === "string" && message.trim()) return message;
      }
    } catch {
      /* fall through */
    }
  }
  return parseFunctionError(error);
}

export { normalizeRedemptionCode };

export function isRedeemerSession(session: Session | null | undefined): boolean {
  return isRedeemerSessionLike(session);
}

export async function getOrCreateRedemptionInstallId(): Promise<string> {
  const existing = await AsyncStorage.getItem(INSTALL_ID_KEY).catch(() => null);
  if (existing && existing.length >= 8) return existing;
  const created = randomInstallId();
  await AsyncStorage.setItem(INSTALL_ID_KEY, created);
  return created;
}

export async function loadRedemptionModeState(): Promise<RedemptionModeState | null> {
  return safeParseState(await AsyncStorage.getItem(REDEMPTION_MODE_STATE_KEY).catch(() => null));
}

async function saveRedemptionModeState(state: RedemptionModeState): Promise<void> {
  await AsyncStorage.setItem(REDEMPTION_MODE_STATE_KEY, JSON.stringify(state));
}

export async function clearRedemptionModeStorage(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(REDEMPTION_MODE_STATE_KEY).catch(() => {}),
    secureDeleteItem(OWNER_SESSION_BACKUP_KEY).catch(() => {}),
    secureDeleteItem(STAFF_SESSION_BACKUP_KEY).catch(() => {}),
    secureDeleteItem(EXIT_TOKEN_KEY).catch(() => {}),
  ]);
}

export async function forceClearRedemptionModeAndSignOut(): Promise<void> {
  await clearRedemptionModeStorage();
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});
}

export async function ensureRedemptionModeSessionOnBoot(): Promise<{
  state: RedemptionModeState | null;
  status: "inactive" | "ready" | "expired";
}> {
  const state = await loadRedemptionModeState();
  if (!state) return { state: null, status: "inactive" };

  const current = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
  const session = current.data.session;
  if (isRedeemerSession(session)) {
    return { state, status: "ready" };
  }

  const staffSession = safeParseSession(await secureGetItem(STAFF_SESSION_BACKUP_KEY));
  if (staffSession) {
    const { error } = await supabase.auth.setSession({
      access_token: staffSession.access_token,
      refresh_token: staffSession.refresh_token,
    });
    if (!error) {
      return { state, status: "ready" };
    }
  }

  await supabase.auth.signOut({ scope: "local" }).catch(() => {});
  return { state, status: "expired" };
}

export async function activateRedemptionMode(args: {
  businessId: string;
  deviceLabel: string;
  pin: string;
}): Promise<RedemptionModeState> {
  const ownerSessionResult = await supabase.auth.getSession();
  const ownerSession = ownerSessionResult.data.session;
  if (!ownerSession || isRedeemerSession(ownerSession)) {
    throw new Error("Owner session is required to activate Redemption Mode.");
  }

  const installId = await getOrCreateRedemptionInstallId();
  await secureSetItem(OWNER_SESSION_BACKUP_KEY, JSON.stringify(ownerSession));

  const { data, error } = await supabase.functions.invoke("activate-redemption-mode", {
    body: {
      business_id: args.businessId,
      install_id: installId,
      device_label: args.deviceLabel,
      pin: args.pin,
    },
    timeout: EDGE_FUNCTION_TIMEOUT_MS,
  });

  if (error) {
    await secureDeleteItem(OWNER_SESSION_BACKUP_KEY).catch(() => {});
    throw new Error(await invokeErrorMessage(error));
  }

  const result = data as {
    session?: Session;
    device?: { id?: string; business_id?: string; device_label?: string; activated_at?: string | null };
    exit_token?: string;
  };
  if (!result.session?.access_token || !result.session.refresh_token || !result.device?.id || !result.exit_token) {
    await secureDeleteItem(OWNER_SESSION_BACKUP_KEY).catch(() => {});
    throw new Error("Server did not return a restricted staff session.");
  }

  const state: RedemptionModeState = {
    active: true,
    businessId: String(result.device.business_id ?? args.businessId),
    deviceId: result.device.id,
    installId,
    deviceLabel: String(result.device.device_label ?? args.deviceLabel),
    activatedAt: result.device.activated_at ?? null,
  };

  await secureSetItem(STAFF_SESSION_BACKUP_KEY, JSON.stringify(result.session));
  await secureSetItem(EXIT_TOKEN_KEY, result.exit_token);
  await saveRedemptionModeState(state);

  const { error: setSessionError } = await supabase.auth.setSession({
    access_token: result.session.access_token,
    refresh_token: result.session.refresh_token,
  });
  if (setSessionError) {
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    throw new Error("Restricted staff session could not be started. The device is locked; reopen the app and exit with the PIN.");
  }

  return state;
}

export async function exitRedemptionMode(pin: string): Promise<{ ownerRestored: boolean }> {
  const [state, exitToken] = await Promise.all([
    loadRedemptionModeState(),
    secureGetItem(EXIT_TOKEN_KEY),
  ]);
  if (!state || !exitToken) {
    await forceClearRedemptionModeAndSignOut();
    return { ownerRestored: false };
  }

  const { error } = await supabase.functions.invoke("exit-redemption-mode", {
    body: {
      device_id: state.deviceId,
      exit_token: exitToken,
      pin,
    },
    timeout: EDGE_FUNCTION_TIMEOUT_MS,
  });
  if (error) {
    throw new Error(await invokeErrorMessage(error));
  }

  await supabase.auth.signOut({ scope: "local" }).catch(() => {});

  const ownerSession = safeParseSession(await secureGetItem(OWNER_SESSION_BACKUP_KEY));
  if (ownerSession) {
    const { error: restoreError } = await supabase.auth.setSession({
      access_token: ownerSession.access_token,
      refresh_token: ownerSession.refresh_token,
    });
    if (!restoreError) {
      await clearRedemptionModeStorage();
      return { ownerRestored: true };
    }
  }

  await forceClearRedemptionModeAndSignOut();
  return { ownerRestored: false };
}

async function invokeStaffRedemption(
  action: "preview" | "confirm",
  body: { token?: string; short_code?: string },
): Promise<StaffRedemptionResult> {
  const { data, error } = await supabase.functions.invoke("staff-redemption", {
    body: { action, ...body },
    timeout: EDGE_FUNCTION_TIMEOUT_MS,
  });
  if (error) throw new Error(await invokeErrorMessage(error));
  const result = data as StaffRedemptionResult & { error?: string };
  if (!result || typeof result !== "object") throw new Error("Unexpected redemption response.");
  if (result.error && result.ok !== true) throw new Error(result.error);
  return result;
}

export function previewStaffRedemption(body: { token?: string; short_code?: string }) {
  return invokeStaffRedemption("preview", body);
}

export function confirmStaffRedemption(body: { token?: string; short_code?: string }) {
  return invokeStaffRedemption("confirm", body);
}

export async function listRedemptionDevices(businessId: string): Promise<RedemptionDeviceSummary[]> {
  const { data, error } = await supabase.functions.invoke("manage-redemption-devices", {
    body: { action: "list", business_id: businessId },
    timeout: EDGE_FUNCTION_TIMEOUT_MS,
  });
  if (error) throw new Error(await invokeErrorMessage(error));
  const devices = (data as { devices?: unknown[] } | null)?.devices;
  return Array.isArray(devices) ? (devices as RedemptionDeviceSummary[]) : [];
}

export async function deactivateRedemptionDevice(businessId: string, deviceId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("manage-redemption-devices", {
    body: { action: "deactivate", business_id: businessId, device_id: deviceId },
    timeout: EDGE_FUNCTION_TIMEOUT_MS,
  });
  if (error) throw new Error(await invokeErrorMessage(error));
}

export async function removeRedemptionDevice(businessId: string, deviceId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("manage-redemption-devices", {
    body: { action: "remove", business_id: businessId, device_id: deviceId },
    timeout: EDGE_FUNCTION_TIMEOUT_MS,
  });
  if (error) throw new Error(await invokeErrorMessage(error));
}
