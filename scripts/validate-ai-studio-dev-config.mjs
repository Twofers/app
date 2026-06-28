import { spawnSync } from "node:child_process";

const PROD_SUPABASE_HOST = "kvodhiqhdqnptqovovia.supabase.co";
const REQUIRED_PROD_VERSION_CODE = 27;
const EXPO_DEV_CLIENT_PLUGIN = "expo-dev-client";

function expoConfig(envOverrides) {
  const result = spawnSync(process.execPath, ["node_modules/expo/bin/cli", "config", "--type", "prebuild", "--json"], {
    cwd: process.cwd(),
    env: { ...process.env, ...envOverrides },
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || "").trim();
    throw new Error(`expo config failed: ${details}`);
  }

  const raw = result.stdout.replace(/^\uFEFF/, "").trim();
  const firstBrace = raw.indexOf("{");
  if (firstBrace < 0) {
    throw new Error("expo config did not return JSON");
  }
  return JSON.parse(raw.slice(firstBrace));
}

function intentHosts(config) {
  return (config.android?.intentFilters ?? [])
    .flatMap((filter) => filter.data ?? [])
    .map((entry) => entry.host)
    .filter(Boolean);
}

function pluginNames(config) {
  return (config.plugins ?? []).map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin));
}

function assertCheck(name, passed, summary) {
  summary.checks.push({ name, passed });
  if (!passed) {
    summary.failed = true;
  }
}

const devEnv = {
  TWOFER_APP_VARIANT: "ai-studio-dev",
  EXPO_PUBLIC_APP_VARIANT: "ai-studio-dev",
  EXPO_PUBLIC_ENABLE_AI_DEAL_STUDIO_DEV: "true",
  EXPO_PUBLIC_DISABLE_AI_STUDIO_PUBLISHING: "true",
};

const devConfig = expoConfig(devEnv);
const prodConfig = expoConfig({
  EAS_BUILD_PROFILE: "production",
  TWOFER_APP_VARIANT: "",
  EXPO_PUBLIC_APP_VARIANT: "",
  EXPO_PUBLIC_ENABLE_AI_DEAL_STUDIO_DEV: "",
  EXPO_PUBLIC_DISABLE_AI_STUDIO_PUBLISHING: "",
  TWOFER_ENABLE_DEV_CLIENT_PLUGIN: "",
});

const devHosts = intentHosts(devConfig);
const devSupabaseHost = devHosts.find((host) => host.endsWith(".supabase.co") && host !== PROD_SUPABASE_HOST) ?? null;
const devPlugins = pluginNames(devConfig);
const prodPlugins = pluginNames(prodConfig);
const devPublishingDisabled = devConfig.extra?.aiStudioDevPublishingDisabled === true;
const summary = {
  dev: {
    name: devConfig.name,
    package: devConfig.android?.package,
    intentHosts: devHosts,
    supabaseHost: devSupabaseHost === PROD_SUPABASE_HOST ? "PRODUCTION_HOST_BLOCKED" : devSupabaseHost,
    publishingDisabled: devPublishingDisabled,
    hasDevClientPlugin: devPlugins.includes(EXPO_DEV_CLIENT_PLUGIN),
  },
  production: {
    name: prodConfig.name,
    package: prodConfig.android?.package,
    versionCode: prodConfig.android?.versionCode,
    hasDevClientPlugin: prodPlugins.includes(EXPO_DEV_CLIENT_PLUGIN),
  },
  checks: [],
  failed: false,
};

assertCheck("dev app name is Twofer Dev", devConfig.name === "Twofer Dev", summary);
assertCheck("dev package is com.unvmex2.twoforone.dev", devConfig.android?.package === "com.unvmex2.twoforone.dev", summary);
assertCheck("dev intent filters do not include production Supabase host", !devHosts.includes(PROD_SUPABASE_HOST), summary);
assertCheck("dev Supabase URL is set", Boolean(devSupabaseHost), summary);
assertCheck("dev Supabase URL is not production", devSupabaseHost !== PROD_SUPABASE_HOST, summary);
assertCheck("AI Studio publishing is disabled", devPublishingDisabled, summary);
assertCheck("dev config includes expo-dev-client plugin", devPlugins.includes(EXPO_DEV_CLIENT_PLUGIN), summary);
assertCheck("production app name is Twofer", prodConfig.name === "Twofer", summary);
assertCheck("production package is com.unvmex2.twoforone", prodConfig.android?.package === "com.unvmex2.twoforone", summary);
assertCheck("production versionCode is 27", prodConfig.android?.versionCode === REQUIRED_PROD_VERSION_CODE, summary);
assertCheck("production config excludes expo-dev-client plugin", !prodPlugins.includes(EXPO_DEV_CLIENT_PLUGIN), summary);

console.log(JSON.stringify(summary, null, 2));

if (summary.failed) {
  process.exitCode = 1;
}
