import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory AsyncStorage stand-in, keyed exactly like the real module's
// getItem/setItem/removeItem contract — enough for getConsumerPreferences +
// setConsumerNotificationPrefs to round-trip through it.
const h = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => (h.store.has(key) ? h.store.get(key)! : null)),
    setItem: vi.fn(async (key: string, value: string) => {
      h.store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      h.store.delete(key);
    }),
  },
}));

const { getConsumerPreferences, setConsumerNotificationPrefs } = await import("./consumer-preferences");

beforeEach(() => {
  h.store.clear();
});

// These three cases are exactly what app/(tabs)/index.tsx's enableDealAlerts now
// relies on: it reads getConsumerPreferences().notificationPrefs and forwards it
// unchanged to setConsumerNotificationPrefs, rather than hardcoding
// { mode: "favorites_only" } and silently downgrading an all_nearby (or unset,
// defaulted-to-all_nearby) cold-start user.
describe("getConsumerPreferences notification mode round-trip", () => {
  it("preserves an existing all_nearby mode", async () => {
    await setConsumerNotificationPrefs({ v: 1, mode: "all_nearby" });

    const prefs = await getConsumerPreferences();

    expect(prefs.notificationPrefs).toEqual({ v: 1, mode: "all_nearby" });
  });

  it("defaults to all_nearby when no prefs were ever stored", async () => {
    const prefs = await getConsumerPreferences();

    expect(prefs.notificationPrefs).toEqual({ v: 1, mode: "all_nearby" });
  });

  it("preserves an existing favorites_only mode", async () => {
    await setConsumerNotificationPrefs({ v: 1, mode: "favorites_only" });

    const prefs = await getConsumerPreferences();

    expect(prefs.notificationPrefs).toEqual({ v: 1, mode: "favorites_only" });
  });
});
