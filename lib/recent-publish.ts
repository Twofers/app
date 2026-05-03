/**
 * Tiny cross-screen flash for "deal just published" success.
 *
 * Why AsyncStorage and not just navigation params: `publishDeal` does
 * `router.replace("/(tabs)")`, which lands on the tabs route group. The active tab
 * is decided by tab-mode + last-visited tab — we can't reliably target the dashboard
 * with params, and route params on the layout don't always survive to the tab.
 *
 * AsyncStorage with a short TTL is the simplest pattern that survives the redirect
 * and won't fire stale toasts hours later if something goes wrong.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "twofer.recentPublish.v1";
const TTL_MS = 30_000;

type Payload = { title: string; ts: number };

export async function markRecentPublish(title: string): Promise<void> {
  try {
    const payload: Payload = { title: title.slice(0, 80), ts: Date.now() };
    await AsyncStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // Non-fatal — losing the toast is far better than blocking the publish redirect.
  }
}

export async function consumeRecentPublish(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    await AsyncStorage.removeItem(KEY);
    const p = JSON.parse(raw) as Partial<Payload>;
    const title = typeof p.title === "string" ? p.title : "";
    const ts = typeof p.ts === "number" ? p.ts : 0;
    if (!title || !ts) return null;
    if (Date.now() - ts > TTL_MS) return null;
    return title;
  } catch {
    return null;
  }
}
