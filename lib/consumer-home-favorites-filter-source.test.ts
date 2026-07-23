import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const homeSource = readFileSync(join(process.cwd(), "app", "(tabs)", "index.tsx"), "utf8");
const settingsSource = readFileSync(join(process.cwd(), "app", "(tabs)", "settings.tsx"), "utf8");

describe("consumer Home favorites filter source guards", () => {
  it("keeps notification delivery mode separate from deal and shop visibility", () => {
    const hydrateStart = homeSource.indexOf("const hydrateLocationFromPrefs = useCallback");
    const hydrateEnd = homeSource.indexOf("}, [userId]);", hydrateStart);
    const hydrateSource = homeSource.slice(hydrateStart, hydrateEnd);

    expect(hydrateStart).toBeGreaterThan(-1);
    expect(hydrateEnd).toBeGreaterThan(hydrateStart);
    expect(hydrateSource).not.toContain("setFavoritesOnly");
    expect(hydrateSource).not.toContain('notificationPrefs.mode === "favorites_only"');
  });

  it("keeps favorites-only alerts in Settings and browsing control on Home", () => {
    expect(settingsSource).toContain('applyNotifMode("favorites_only")');
    expect(settingsSource).toContain("setConsumerNotificationPrefs({ v: 1, mode: m })");
    expect(homeSource).toContain("onPress={() => setFavoritesOnly(!favoritesOnly)}");
  });
});
