import { describe, expect, it } from "vitest";

import {
  classifyQrDevice,
  dailyQrIpHash,
  normalizeQrSlug,
  resolveQrRedirect,
} from "./qr-campaign.ts";

describe("QR campaign helpers", () => {
  it("accepts only normalized opaque campaign slugs", () => {
    expect(normalizeQrSlug("  cafe-counter-a1b2c3  ")).toBe("cafe-counter-a1b2c3");
    expect(normalizeQrSlug("short")).toBeNull();
    expect(normalizeQrSlug("valid_slug_123")).toBeNull();
    expect(normalizeQrSlug("https://evil.example")).toBeNull();
  });

  it("classifies phones, tablets, desktop, and automation conservatively", () => {
    expect(classifyQrDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("ios_phone");
    expect(classifyQrDevice("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit Mobile")).toBe("android_phone");
    expect(classifyQrDevice("Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit")).toBe("android_tablet");
    expect(classifyQrDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("desktop");
    expect(classifyQrDevice("facebookexternalhit/1.1")).toBe("bot");
    expect(classifyQrDevice("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)")).toBe("unknown");
  });

  it("chooses only configured HTTPS destinations and otherwise uses the website", () => {
    const config = {
      iosAppStoreUrl: "https://apps.apple.com/us/app/twofer/id123",
      androidPlayStoreUrl: "https://play.google.com/store/apps/details?id=com.unvmex2.twoforone",
      websiteUrl: "https://www.twoferapp.com/",
    };
    expect(resolveQrRedirect({ destinationType: "app_download", deviceType: "ios_phone", config })).toEqual({
      targetType: "ios_app_store",
      url: config.iosAppStoreUrl,
    });
    expect(resolveQrRedirect({ destinationType: "app_download", deviceType: "android_phone", config })).toEqual({
      targetType: "android_play_store",
      url: config.androidPlayStoreUrl,
    });
    expect(resolveQrRedirect({ destinationType: "app_download", deviceType: "desktop", config })).toEqual({
      targetType: "website",
      url: config.websiteUrl,
    });
    expect(resolveQrRedirect({
      destinationType: "app_download",
      deviceType: "ios_phone",
      config: { ...config, iosAppStoreUrl: "javascript:alert(1)" },
    })).toEqual({ targetType: "website", url: config.websiteUrl });
  });

  it("uses a stable daily HMAC without returning the raw IP", async () => {
    const params = { ip: "203.0.113.25", secret: "test-pepper", now: new Date("2026-07-14T10:00:00.000Z") };
    const first = await dailyQrIpHash(params);
    const second = await dailyQrIpHash(params);
    const nextDay = await dailyQrIpHash({ ...params, now: new Date("2026-07-15T10:00:00.000Z") });
    expect(first).toEqual(second);
    expect(first?.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(first?.hash).not.toContain(params.ip);
    expect(nextDay?.hash).not.toBe(first?.hash);
    await expect(dailyQrIpHash({ ip: null, secret: params.secret })).resolves.toBeNull();
  });
});
