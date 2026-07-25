import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appJson = JSON.parse(readFileSync(join(process.cwd(), "app.json"), "utf8"));
const easJson = JSON.parse(readFileSync(join(process.cwd(), "eas.json"), "utf8"));

const plugins: unknown[] = appJson.expo.plugins ?? [];
const googlePlugin = plugins.find(
  (p): p is [string, { iosUrlScheme?: string }] =>
    Array.isArray(p) && p[0] === "@react-native-google-signin/google-signin",
);
const prodEnv: Record<string, string> = easJson.build.production.env ?? {};

describe("native sign-in configuration", () => {
  // Why this exists: app.json shipped `com.googleusercontent.apps.REPLACE-WITH-IOS-CLIENT-ID`
  // all the way to the first 1.0.1 build attempt (2026-07-25). eas.json carried
  // real client IDs, so an audit that only looked there reported "no
  // placeholders" and missed it. iosUrlScheme is the OAuth callback scheme
  // written into Info.plist — wrong value means Google auth opens and the
  // redirect never lands back in the app, on iOS only.

  it("has the Google sign-in plugin configured", () => {
    expect(googlePlugin, "@react-native-google-signin/google-signin plugin missing from app.json").toBeDefined();
  });

  it("carries no unreplaced placeholder anywhere in app.json", () => {
    expect(JSON.stringify(appJson)).not.toMatch(/REPLACE[-_ ]?WITH/i);
  });

  it("derives iosUrlScheme from the production iOS client ID", () => {
    const iosClientId = prodEnv.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "";
    expect(iosClientId).toMatch(/\.apps\.googleusercontent\.com$/);
    const expected = `com.googleusercontent.apps.${iosClientId.replace(".apps.googleusercontent.com", "")}`;
    expect(googlePlugin?.[1]?.iosUrlScheme).toBe(expected);
  });

  it("keeps the web and iOS client IDs distinct and real", () => {
    const web = prodEnv.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";
    const ios = prodEnv.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "";
    expect(web).toMatch(/\.apps\.googleusercontent\.com$/);
    expect(ios).toMatch(/\.apps\.googleusercontent\.com$/);
    // Reusing one ID for both is a real misconfiguration: iOS tokens carry the
    // iOS client ID as audience, so Supabase must be given both.
    expect(web).not.toBe(ios);
  });

  it("keeps Sign in with Apple enabled for iOS", () => {
    expect(appJson.expo.ios.usesAppleSignIn).toBe(true);
    expect(plugins).toContain("expo-apple-authentication");
  });

  it("keeps social auth switched on for production builds", () => {
    expect(prodEnv.EXPO_PUBLIC_ENABLE_SOCIAL_AUTH).toBe("true");
  });
});
