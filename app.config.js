const { execSync } = require("child_process");

function resolveGitCommitShort() {
  const fromEnv =
    process.env.EXPO_PUBLIC_GIT_COMMIT?.trim() ||
    process.env.EAS_BUILD_GIT_COMMIT_HASH?.trim() ||
    process.env.GITHUB_SHA?.trim();
  if (fromEnv) return fromEnv.length > 12 ? fromEnv.slice(0, 12) : fromEnv;
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/** Merges env-based EAS project id with static app.json (Expo loads both). */
module.exports = ({ config }) => ({
  ...config,
  name: "TWOFER",
  ios: {
    ...config.ios,
    infoPlist: {
      ...config.ios?.infoPlist,
      CFBundleDisplayName: "TWOFER",
    },
  },
  android: {
    ...config.android,
    config: {
      ...config.android?.config,
      googleMaps: {
        apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY ?? config.android?.config?.googleMaps?.apiKey ?? "",
      },
    },
  },
  extra: {
    ...config.extra,
    /** Mirrors android.config.googleMaps — JS can skip MapView when empty to avoid native crashes. */
    androidMapsKeyConfigured: Boolean(String(process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY ?? "").trim()),
    gitCommit: resolveGitCommitShort(),
    easBuildProfile: process.env.EAS_BUILD_PROFILE ?? null,
    eas: {
      ...config.extra?.eas,
      projectId: process.env.EAS_PROJECT_ID ?? config.extra?.eas?.projectId,
    },
  },
});
