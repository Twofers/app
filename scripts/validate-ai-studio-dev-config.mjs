import { spawnSync } from "node:child_process";

const PROD_SUPABASE_HOST = "kvodhiqhdqnptqovovia.supabase.co";
const REQUIRED_PROD_VERSION_CODE = 23;

function expoConfig(envOverrides) {
  const result = spawnSync(process.execPath, ["node_modules/expo/bin/cli", "config", "--type", "public", "--json"], {
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

function hostFromUrl(value) {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).host;
  } catch {
    return "INVALID_URL";
  }
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
  TWOFER_APP_VARIANT: "",
  EXPO_PUBLIC_APP_VARIANT: "",
  EXPO_PUBLIC_ENABLE_AI_DEAL_STUDIO_DEV: "",
  EXPO_PUBLIC_DISABLE_AI_STUDIO_PUBLISHING: "",
});

const devHosts = intentHosts(devConfig);
const devSupabaseHost = hostFromUrl(process.env.EXPO_PUBLIC_SUPABASE_URL);
const summary = {
  dev: {
    name: devConfig.name,
    package: devConfig.android?.package,
    intentHosts: devHosts,
    supabaseHost: devSupabaseHost === PROD_SUPABASE_HOST ? "PRODUCTION_HOST_BLOCKED" : devSupabaseHost,
    publishingDisabled: process.env.EXPO_PUBLIC_DISABLE_AI_STUDIO_PUBLISHING === "true",
  },
  production: {
    name: prodConfig.name,
    package: prodConfig.android?.package,
    versionCode: prodConfig.android?.versionCode,
  },
  checks: [],
  failed: false,
};

assertCheck("dev app name is Twofer Dev", devConfig.name === "Twofer Dev", summary);
assertCheck("dev package is com.unvmex2.twoforone.dev", devConfig.android?.package === "com.unvmex2.twoforone.dev", summary);
assertCheck("dev intent filters do not include production Supabase host", !devHosts.includes(PROD_SUPABASE_HOST), summary);
assertCheck("dev Supabase URL is set", Boolean(devSupabaseHost), summary);
assertCheck("dev Supabase URL is not production", devSupabaseHost !== PROD_SUPABASE_HOST, summary);
assertCheck("AI Studio publishing is disabled", process.env.EXPO_PUBLIC_DISABLE_AI_STUDIO_PUBLISHING === "true", summary);
assertCheck("production app name is Twofer", prodConfig.name === "Twofer", summary);
assertCheck("production package is com.unvmex2.twoforone", prodConfig.android?.package === "com.unvmex2.twoforone", summary);
assertCheck("production versionCode is 23", prodConfig.android?.versionCode === REQUIRED_PROD_VERSION_CODE, summary);

console.log(JSON.stringify(summary, null, 2));

if (summary.failed) {
  process.exitCode = 1;
}
