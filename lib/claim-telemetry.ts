import { Platform } from "react-native";
import Constants from "expo-constants";
import type { ConsumerLocationMode } from "@/lib/consumer-preferences";
import { getConsumerPreferences } from "@/lib/consumer-preferences";

export const ACQUISITION_SOURCES = [
  "organic",
  "push",
  "favorite",
  "search",
  "direct",
  "campaign",
  "unknown",
] as const;

export type AcquisitionSource = (typeof ACQUISITION_SOURCES)[number];

function locationSourceFromPrefs(mode: ConsumerLocationMode): "gps" | "zip" | "unknown" {
  if (mode === "gps") return "gps";
  if (mode === "zip") return "zip";
  return "unknown";
}

export type ClaimDealTelemetry = {
  acquisition_source: AcquisitionSource;
  zip_at_claim: string | null;
  location_source_at_claim: "gps" | "zip" | "unknown" | null;
  app_version_at_claim: string | null;
  device_platform_at_claim: string | null;
};

export async function buildClaimDealTelemetry(
  acquisition: AcquisitionSource = "unknown",
): Promise<ClaimDealTelemetry> {
  const prefs = await getConsumerPreferences();
  const zip = prefs.zipCode?.trim() || null;
  return {
    acquisition_source: acquisition,
    zip_at_claim: zip,
    location_source_at_claim: locationSourceFromPrefs(prefs.locationMode),
    app_version_at_claim: Constants.expoConfig?.version ?? (Constants as { nativeAppVersion?: string }).nativeAppVersion ?? null,
    device_platform_at_claim: Platform.OS,
  };
}
