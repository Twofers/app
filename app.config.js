const { execSync } = require("child_process");

const PRODUCTION_ANDROID_PACKAGE = "com.unvmex2.twoforone";
const AI_STUDIO_DEV_ANDROID_PACKAGE = "com.unvmex2.twoforone.dev";
const PRODUCTION_APP_NAME = "Twofer";
const AI_STUDIO_DEV_APP_NAME = "Twofer Dev";
const PRODUCTION_SUPABASE_HOST = "kvodhiqhdqnptqovovia.supabase.co";
const AI_STUDIO_DEV_VARIANT = "ai-studio-dev";
const EXPO_DEV_CLIENT_PLUGIN = "expo-dev-client";
const AI_STUDIO_DEV_EAS_PROFILE = "dev-apk-ai-studio";
const DEV_CLIENT_EAS_PROFILES = new Set(["development", "dev-client-apk", AI_STUDIO_DEV_EAS_PROFILE]);
const PRODUCTION_LIKE_EAS_PROFILES = new Set(["production", "apk", "preview"]);

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

function isAiStudioDevVariant() {
  const buildProfile = process.env.EAS_BUILD_PROFILE;
  if (buildProfile) {
    return buildProfile === AI_STUDIO_DEV_EAS_PROFILE;
  }
  return (
    process.env.TWOFER_APP_VARIANT === AI_STUDIO_DEV_VARIANT ||
    process.env.EXPO_PUBLIC_APP_VARIANT === AI_STUDIO_DEV_VARIANT
  );
}

function hostFromUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
}

function resolveAndroidIntentFilters(config, aiStudioDev) {
  const existing = Array.isArray(config.android?.intentFilters) ? config.android.intentFilters : [];
  if (!aiStudioDev) return existing;

  const withoutProductionSupabase = existing.filter((filter) => {
    const data = Array.isArray(filter?.data) ? filter.data : [];
    return !data.some((entry) => entry?.host === PRODUCTION_SUPABASE_HOST);
  });
  const devSupabaseHost = hostFromUrl(process.env.EXPO_PUBLIC_SUPABASE_URL);
  if (!devSupabaseHost || devSupabaseHost === PRODUCTION_SUPABASE_HOST) return withoutProductionSupabase;

  return [
    ...withoutProductionSupabase,
    {
      action: "VIEW",
      autoVerify: false,
      data: [
        {
          scheme: "https",
          host: devSupabaseHost,
          pathPrefix: "/functions/v1/deal-link",
        },
      ],
      category: ["BROWSABLE", "DEFAULT"],
    },
  ];
}

function pluginName(plugin) {
  return Array.isArray(plugin) ? plugin[0] : plugin;
}

function withoutPlugin(plugins, name) {
  return plugins.filter((plugin) => pluginName(plugin) !== name);
}

function withPluginOnce(plugins, plugin) {
  const name = pluginName(plugin);
  return plugins.some((existing) => pluginName(existing) === name) ? plugins : [...plugins, plugin];
}

function shouldIncludeDevClientPlugin(aiStudioDev) {
  if (aiStudioDev) return true;
  if (process.env.TWOFER_ENABLE_DEV_CLIENT_PLUGIN === "true") return true;
  if (process.env.TWOFER_ENABLE_DEV_CLIENT_PLUGIN === "false") return false;

  const buildProfile = process.env.EAS_BUILD_PROFILE;
  if (buildProfile) {
    if (PRODUCTION_LIKE_EAS_PROFILES.has(buildProfile)) return false;
    return DEV_CLIENT_EAS_PROFILES.has(buildProfile);
  }

  return process.env.NODE_ENV !== "production";
}

function resolvePlugins(config, aiStudioDev) {
  const existing = Array.isArray(config.plugins) ? config.plugins : [];
  const devClientReady = shouldIncludeDevClientPlugin(aiStudioDev)
    ? withPluginOnce(existing, EXPO_DEV_CLIENT_PLUGIN)
    : withoutPlugin(existing, EXPO_DEV_CLIENT_PLUGIN);

  if (!aiStudioDev) return devClientReady;
  return withPluginOnce(devClientReady, "./plugins/with-android-dev-google-services-skip");
}

/** Merges env-based EAS project id with static app.json (Expo loads both). */
module.exports = ({ config }) => {
  const aiStudioDev = isAiStudioDevVariant();
  const appName = aiStudioDev ? AI_STUDIO_DEV_APP_NAME : PRODUCTION_APP_NAME;
  const androidPackage = aiStudioDev ? AI_STUDIO_DEV_ANDROID_PACKAGE : PRODUCTION_ANDROID_PACKAGE;

  return {
    ...config,
    /** Prebuild: keep New Architecture enabled across native regeneration. */
    newArchEnabled: true,
    name: appName,
    plugins: resolvePlugins(config, aiStudioDev),
    ios: {
      ...config.ios,
      infoPlist: {
        ...config.ios?.infoPlist,
        CFBundleDisplayName: appName,
      },
    },
    android: {
      ...config.android,
      package: androidPackage,
      googleServicesFile: aiStudioDev ? undefined : config.android?.googleServicesFile,
      intentFilters: resolveAndroidIntentFilters(config, aiStudioDev),
      newArchEnabled: true,
      config: {
        ...config.android?.config,
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY ?? config.android?.config?.googleMaps?.apiKey ?? "",
        },
      },
    },
    extra: {
      ...config.extra,
      appVariant: aiStudioDev ? AI_STUDIO_DEV_VARIANT : "production",
      androidPackage,
      productionSupabaseHost: PRODUCTION_SUPABASE_HOST,
      aiStudioDevPublishingDisabled: process.env.EXPO_PUBLIC_DISABLE_AI_STUDIO_PUBLISHING === "true",
      /** Mirrors android.config.googleMaps - JS can skip MapView when empty to avoid native crashes. */
      androidMapsKeyConfigured: Boolean(String(process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY ?? "").trim()),
      gitCommit: resolveGitCommitShort(),
      easBuildProfile: process.env.EAS_BUILD_PROFILE ?? null,
      eas: {
        ...config.extra?.eas,
        projectId: process.env.EAS_PROJECT_ID ?? config.extra?.eas?.projectId,
      },
    },
  };
};
