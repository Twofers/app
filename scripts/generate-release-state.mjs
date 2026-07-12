// Generated release-state inventory (audit F-012).
//
// Hand-maintained docs kept asserting versions/counts/flags that drifted from
// the code (e.g. versionCode 31 vs the real 49). This script derives those
// facts FROM SOURCE and writes docs/release-audit/generated-state.md (+ .json)
// so docs can link to generated truth instead of restating it.
//
//   node scripts/generate-release-state.mjs           # regenerate the files
//   node scripts/generate-release-state.mjs --check   # CI drift gate: fail if
//                                                     # the committed copy is
//                                                     # stale vs the code
//
// The hosted half (supabase CLI comparison of migrations/functions against the
// production project) requires credentials and is intentionally NOT run here;
// see the "Hosted comparison" section of the generated doc.
//
// Dependency-free Node. Read-only except for the two generated files.

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_MD = path.join(ROOT, "docs", "release-audit", "generated-state.md");
const OUT_JSON = path.join(ROOT, "docs", "release-audit", "generated-state.json");

function read(rel) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function grabFlag(source, name) {
  const m = source.match(new RegExp(`${name}\\s*=\\s*(true|false)`));
  return m ? m[1] === "true" : null;
}

function easEnv(eas, profile, key) {
  return eas.build?.[profile]?.env?.[key] ?? null;
}

function collect() {
  const appJson = JSON.parse(read("app.json"));
  const eas = JSON.parse(read("eas.json"));
  const pkg = JSON.parse(read("package.json"));
  const billingAccess = read("lib/billing/access.ts");

  const migrations = readdirSync(path.join(ROOT, "supabase", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const functions = readdirSync(path.join(ROOT, "supabase", "functions"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "_shared")
    .map((d) => d.name)
    .sort();

  const easFlagKeys = [
    "EXPO_PUBLIC_ENABLE_SHARE_DEAL",
    "EXPO_PUBLIC_ENABLE_NATIVE_WALLET_PASS",
    "EXPO_PUBLIC_ENABLE_MOBILE_BILLING_LINKS",
    "EXPO_PUBLIC_DISABLE_AI_STUDIO_PUBLISHING",
    "EXPO_PUBLIC_AI_V5_AUTOMATIC_VERIFIED_BUNDLE_APPROVAL_ENABLED",
  ];
  const easProfiles = Object.keys(eas.build ?? {});
  const easFlags = {};
  for (const profile of easProfiles) {
    easFlags[profile] = {};
    for (const key of easFlagKeys) {
      const value = easEnv(eas, profile, key);
      if (value !== null) easFlags[profile][key] = value;
    }
  }

  return {
    app: {
      version: appJson.expo?.version ?? null,
      androidVersionCode: appJson.expo?.android?.versionCode ?? null,
      iosBuildNumber: appJson.expo?.ios?.buildNumber ?? null,
      androidPackage: appJson.expo?.android?.package ?? null,
      iosBundleIdentifier: appJson.expo?.ios?.bundleIdentifier ?? null,
      expoSdk: pkg.dependencies?.expo ?? null,
      reactNative: pkg.dependencies?.["react-native"] ?? null,
    },
    billingFlags: {
      PAID_BILLING_ENABLED: grabFlag(billingAccess, "PAID_BILLING_ENABLED"),
      PILOT_DISABLE_BILLING_GATE: grabFlag(billingAccess, "PILOT_DISABLE_BILLING_GATE"),
    },
    easFlags,
    migrations: {
      count: migrations.length,
      latest: migrations[migrations.length - 1] ?? null,
    },
    edgeFunctions: {
      count: functions.length,
      names: functions,
    },
  };
}

function renderMarkdown(state) {
  const lines = [];
  lines.push("# Generated release state");
  lines.push("");
  lines.push("**Do not hand-edit.** Regenerate with `node scripts/generate-release-state.mjs`.");
  lines.push("CI drift gate: `node scripts/generate-release-state.mjs --check`.");
  lines.push("Docs should link here instead of restating these facts (audit F-012).");
  lines.push("");
  lines.push("## App");
  lines.push("");
  lines.push(`- Version: \`${state.app.version}\``);
  lines.push(`- Android versionCode: \`${state.app.androidVersionCode}\``);
  lines.push(`- iOS buildNumber (app.json): \`${state.app.iosBuildNumber ?? "not set in app.json (managed via EAS)"}\``);
  lines.push(`- Android package: \`${state.app.androidPackage}\``);
  lines.push(`- iOS bundle id: \`${state.app.iosBundleIdentifier}\``);
  lines.push(`- Expo SDK: \`${state.app.expoSdk}\`, React Native: \`${state.app.reactNative}\``);
  lines.push("");
  lines.push("## Billing flags (lib/billing/access.ts)");
  lines.push("");
  for (const [key, value] of Object.entries(state.billingFlags)) {
    lines.push(`- ${key}: \`${value}\``);
  }
  lines.push("");
  lines.push("## EAS build env flags (eas.json)");
  lines.push("");
  for (const [profile, flags] of Object.entries(state.easFlags)) {
    if (!Object.keys(flags).length) continue;
    lines.push(`- **${profile}**`);
    for (const [key, value] of Object.entries(flags)) {
      lines.push(`  - ${key}: \`${value}\``);
    }
  }
  lines.push("");
  lines.push("## Database migrations (supabase/migrations)");
  lines.push("");
  lines.push(`- Count: \`${state.migrations.count}\``);
  lines.push(`- Latest: \`${state.migrations.latest}\``);
  lines.push("");
  lines.push(`## Edge Functions (supabase/functions, ${state.edgeFunctions.count} local)`);
  lines.push("");
  for (const name of state.edgeFunctions.names) lines.push(`- ${name}`);
  lines.push("");
  lines.push("## Hosted comparison (requires credentials — run separately)");
  lines.push("");
  lines.push("- Migrations: `supabase migration list --linked` must show every local file applied and nothing extra.");
  lines.push("- Functions: `supabase functions list` must equal the local list above. A remote-only function is drift");
  lines.push("  (e.g. `ai-refine-ad-copy`, flagged by audit F-013 — see docs/full-system-audit/24_ai_refine_ad_copy_disposition.md).");
  lines.push("");
  return lines.join("\n");
}

const args = new Set(process.argv.slice(2));
const state = collect();
const md = renderMarkdown(state);
const json = JSON.stringify(state, null, 2) + "\n";

if (args.has("--check")) {
  const failures = [];
  for (const [file, fresh] of [[OUT_MD, md], [OUT_JSON, json]]) {
    if (!existsSync(file)) {
      failures.push(`${path.relative(ROOT, file)} is missing — run node scripts/generate-release-state.mjs`);
      continue;
    }
    if (readFileSync(file, "utf8") !== fresh) {
      failures.push(`${path.relative(ROOT, file)} is stale vs the code — run node scripts/generate-release-state.mjs`);
    }
  }
  if (failures.length) {
    console.error("Release-state drift check failed:");
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
  }
  console.log("Release-state drift check passed.");
} else {
  writeFileSync(OUT_MD, md);
  writeFileSync(OUT_JSON, json);
  console.log(`Wrote ${path.relative(ROOT, OUT_MD)} and ${path.relative(ROOT, OUT_JSON)}.`);
  console.log(`App ${state.app.version} (vc ${state.app.androidVersionCode}); ${state.migrations.count} migrations; ${state.edgeFunctions.count} functions.`);
}
