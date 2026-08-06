import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const homeSource = readFileSync(join(process.cwd(), "app", "(tabs)", "index.tsx"), "utf8");

describe("consumer Home cold-start source guards", () => {
  it("enableDealAlerts preserves the existing/default notification mode instead of hardcoding favorites_only", () => {
    const start = homeSource.indexOf("const enableDealAlerts = useCallback");
    const end = homeSource.indexOf("}, [userId]);", start);
    const body = homeSource.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(body).not.toContain('mode: "favorites_only"');
    expect(body).toContain("await getConsumerPreferences()");
    expect(body).toContain("await setConsumerNotificationPrefs(notificationPrefs)");
  });

  it("gates the deals-segment empty state on a true-zero-live-deals signal, separate from emptyNearbyLive", () => {
    expect(homeSource).toMatch(
      /const dealsTrulyZero =\s*!loadingDeals && repeatVisibleDeals\.length === 0;/,
    );
    // The generic ListEmptyComponent branch must check dealsTrulyZero before
    // falling back to the plain "No live deals" EmptyState — search-no-matches
    // (repeatVisibleDeals non-empty, searchFilteredDeals empty) still gets the
    // lighter generic copy, only the true cold-start case gets the growth CTA.
    const emptyStart = homeSource.indexOf("ListEmptyComponent={");
    const emptyEnd = homeSource.indexOf("ListFooterComponent={", emptyStart);
    const emptyBody = homeSource.slice(emptyStart, emptyEnd);

    expect(emptyStart).toBeGreaterThan(-1);
    expect(emptyEnd).toBeGreaterThan(emptyStart);
    expect(emptyBody).toContain("dealsTrulyZero");
    expect(emptyBody).toContain('t("consumerHome.emptyZeroBrowseCta")');
    expect(emptyBody).toContain('onPress={() => setFeedSegment("shops")}');
    expect(emptyBody).toContain("!dealAlertsEnabled");
    expect(emptyBody).toContain('t("consumerHome.emptyZeroAlertsCta")');
    expect(emptyBody).toContain('t("consumerHome.requestBusinessPrompt")');
    expect(emptyBody).toContain("setRequestBusinessVisible(true)");
  });

  it("offers a request-business footer row on the Shops segment", () => {
    const footerStart = homeSource.indexOf("ListFooterComponent={");
    const footerEnd = homeSource.indexOf("/>", footerStart);
    const footerBody = homeSource.slice(footerStart, footerEnd);

    expect(footerStart).toBeGreaterThan(-1);
    expect(footerEnd).toBeGreaterThan(footerStart);
    expect(footerBody).toContain('feedSegment === "shops"');
    expect(footerBody).toContain('t("consumerHome.requestBusinessPrompt")');
    expect(footerBody).toContain("setRequestBusinessVisible(true)");
  });

  it("mounts the RequestBusinessSheet wired to requestBusinessVisible", () => {
    expect(homeSource).toContain("<RequestBusinessSheet");
    expect(homeSource).toContain("visible={requestBusinessVisible}");
  });
});
