import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const functionsRoot = path.join(root, "supabase", "functions");
const configPath = path.join(root, "supabase", "config.toml");
const outputRoot = path.join(root, "docs", "security");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents.replace(/\r?\n/g, "\n"));
}

function configuredPublicFunctions() {
  const config = read(configPath);
  const rows = [];
  let current = null;
  for (const line of config.split(/\r?\n/)) {
    const section = line.match(/^\[functions\.([^\]]+)\]/);
    if (section) {
      current = section[1];
      continue;
    }
    if (current && /^\s*verify_jwt\s*=\s*false\s*$/.test(line)) {
      rows.push(current);
    }
  }
  return rows;
}

function functionSource(name) {
  const file = path.join(functionsRoot, name, "index.ts");
  return fs.existsSync(file) ? read(file) : "";
}

const explicitAuth = new Map([
  ["admin-auth-session", "founder email + mandatory TOTP (passwordless; service-role magiclink mint)/refresh token + active owner UUID"],
  ["stripe-webhook", "Stripe-Signature verified with the webhook signing secret"],
  ["wallet-pass-webservice", "Apple Wallet signed device/pass token"],
  ["exit-redemption-mode", "device exit token + owner PIN, checked in-function"],
  ["cancel-visual-redeem", "retired operation; always returns CANCEL_NOT_SUPPORTED"],
  ["ai-create-deal", "retired operation; always returns HTTP 410"],
  ["qr-campaign-redirect", "deliberately public redirect; campaign slug is the capability"],
  ["deal-link", "deliberately public; signed/share identifier is validated in-function"],
  ["deal-share-lookup", "deliberately public; share code is validated in-function"],
  ["public-local-businesses", "deliberately public read-only directory"],
  ["billing-pricing", "deliberately public read-only pricing"],
  ["submit-business-application", "deliberately public intake"],
  ["submit-launch-signup", "deliberately public intake"],
  ["request-business-on-twofer", "user JWT checked in-function"],
  ["business-claim-link", "signed single-use claim token"],
  ["business-checkout-link", "signed single-use checkout token"],
  ["billing-checkout-redirect", "signed checkout token"],
  ["business-activation-status", "signed activation token"],
  ["simulate-subscribe", "retired operation; always returns HTTP 410"],
  ["get-business-onboarding-context", "signed onboarding token or user JWT, checked in-function"],
  ["stripe-expire-pending-checkout", "x-cron-secret"],
  ["stripe-backfill-customers", "x-cron-secret or privileged user JWT, checked in-function"],
  ["weekly-deal-digest", "x-cron-secret"],
  ["send-trial-ending-reminders", "x-cron-secret"],
  ["expire-billing-access", "x-cron-secret"],
  ["finalize-stale-redeems", "x-cron-secret"],
  ["ingest-analytics-event", "optional user JWT; four pre-auth event names deliberately public"],
]);

function authMechanism(name, source) {
  if (explicitAuth.has(name)) return explicitAuth.get(name);
  if (name.startsWith("admin-")) {
    return "user JWT checked in-function + active admin/role/MFA guard";
  }
  if (/x-cron-secret|CRON_SECRET/i.test(source)) return "x-cron-secret";
  if (/auth\.getUser\s*\(|getUser\s*\(\s*bearer|Authorization/i.test(source)) {
    return "user JWT checked in-function";
  }
  if (/token_hash|tokenHash|signed token|HMAC|crypto\.subtle/i.test(source)) {
    return "signed/hashed capability token checked in-function";
  }
  return "deliberately public or no recognizable auth guard — manual review required";
}

function abuseProtection(name, source, auth) {
  const protections = [];
  if (/RATE_LIMIT|rateLimit|rate_limit|throttl|recentFailed|consume.*limit/i.test(source)) {
    protections.push("application/DB rate limit");
  }
  if (/honeypot|company_website/i.test(source)) protections.push("honeypot");
  if (/single[-_ ]use|token_used_at|expires_at|expiry|expired/i.test(source)) {
    protections.push("single-use/expiry");
  }
  if (/idempot|provider_event_id|duplicate/i.test(source)) protections.push("idempotency/dedupe");
  if (auth.includes("JWT") || auth.includes("admin/role")) protections.push("authenticated caller");
  if (/signed|capability token|device exit token/i.test(auth)) {
    protections.push("signed/scoped capability checked in-function");
  }
  if (/read-only/i.test(auth)) protections.push("read-only operation with bounded query/result");
  if (auth === "x-cron-secret") protections.push("cron secret");
  if (auth.startsWith("Stripe-Signature")) protections.push("signed provider request + event dedupe");
  if (name === "admin-auth-session") {
    protections.push("8 failed sign-in attempts/email/15 minutes");
  }
  if (name === "ingest-analytics-event") {
    protections.push("daily-HMAC IP actor key; atomic 60/actor + 5,000 global per 15 minutes");
  }
  if (name === "qr-campaign-redirect") {
    protections.push("atomic 30/IP + 2,000/campaign per minute DB ceiling");
  }
  if (auth.startsWith("retired operation")) protections.push("no state-changing path");
  return [...new Set(protections)].join("; ") || "none recognized — manual review required";
}

function publicSurfaceMarkdown() {
  const names = configuredPublicFunctions();
  const rows = names.map((name) => {
    const source = functionSource(name);
    const auth = authMechanism(name, source);
    const protection = abuseProtection(name, source, auth);
    return `| \`${name}\` | ${auth} | ${protection} |`;
  });
  return `# Edge-function public-surface inventory

Generated from \`supabase/config.toml\` and function source by
\`node scripts/security/generate-security-inventories.mjs\`.

“Public” here means the Supabase gateway does not validate a JWT. It does not
mean the function is unauthenticated: most functions validate a user JWT,
provider signature, cron secret, or capability token in their own code.

Current count: **${names.length}** functions with \`verify_jwt = false\`.

| Function | In-function authorization | Abuse protection detected |
|---|---|---|
${rows.join("\n")}

## Required review

- \`ingest-analytics-event\` and \`qr-campaign-redirect\` are anonymous-write
  surfaces and must retain a flood/cost ceiling independent of attacker-chosen
  identifiers.
- Any row saying “manual review required” is a release blocker until its intended
  public contract and abuse ceiling are documented or implemented.
- Regenerate this file whenever \`supabase/config.toml\` or an Edge Function auth
  boundary changes.
`;
}

function allFiles(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...allFiles(absolute));
    else result.push(absolute);
  }
  return result;
}

function secretOwner(name) {
  if (/^(BACKUP_|AWS_)/.test(name)) return ["Backup account owner", "separate immutable-backup account", "disable the source credential without deleting retained objects", "mint a backup-only credential with write-with-retention and read-for-drill scope"];
  if (/^CLOUDFLARE_/.test(name)) return ["Cloudflare", "Cloudflare scoped API Tokens", "revoke in Cloudflare", "mint a zone-read token for backups or a separately approved change token"];
  if (/^STRIPE_/.test(name)) return ["Stripe", "Stripe Dashboard/API keys", "roll/revoke in Stripe; update the consuming function secret", "create a least-privilege replacement key/webhook secret"];
  if (/^(OPENAI_|GEMINI_|GOOGLE_AI_)/.test(name)) return ["AI provider", "provider API-key dashboard", "revoke in provider dashboard", "mint a project-scoped replacement with hard spend caps"];
  if (/^RESEND_/.test(name)) return ["Resend", "Resend API Keys", "revoke in Resend", "mint a send-only key for the verified Twofer domain"];
  if (/^(GOOGLE_WALLET_|GOOGLE_PLACES_|GOOGLE_MAPS_|GOOGLE_.*CLIENT)/.test(name)) return ["Google Cloud", "Google Cloud Console", "disable/delete the key or service-account key", "mint a restricted key or scoped service-account key"];
  if (/^APPLE_PASS_/.test(name)) return ["Apple Developer", "Apple Developer certificates", "revoke the pass certificate", "issue a replacement certificate and export encrypted PEM"];
  if (/^(SUPABASE_|SB_)/.test(name)) return ["Supabase", "Supabase project settings", "rotate/revoke in Supabase", "mint a replacement project key/token and update only required consumers"];
  if (/^(CRON_SECRET|QR_.*SECRET|.*_TOKEN_SECRET|.*_ENCRYPTION_KEY)$/.test(name)) return ["Twofer", "offline password manager / CSPRNG", "replace everywhere and invalidate outstanding capabilities", "generate at least 32 random bytes and store only in approved secret stores"];
  if (/^(ADMIN_|FOUNDER_)/.test(name)) return ["Twofer founder", "approved founder configuration", "replace the configured value and audit old use", "issue/configure from the founder-controlled account"];
  if (/^(EXPO_|EAS_)/.test(name)) return ["Expo/EAS", "Expo account/project", "revoke in Expo", "mint a least-privilege replacement token"];
  return ["Twofer / provider owner", "provider dashboard or approved password manager", "follow provider-specific revocation", "re-issue with least privilege and document the owner"];
}

function secretsMarkdown() {
  const references = new Map();
  const sourceRoots = [
    functionsRoot,
    path.join(root, "website", "api"),
    path.join(root, "website", "server"),
    path.join(root, "scripts", "security"),
    path.join(root, ".github", "workflows"),
  ].filter(fs.existsSync);
  const files = sourceRoots
    .flatMap((sourceRoot) => allFiles(sourceRoot))
    .filter((file) => /\.(ts|js|mjs|cjs|sh|ya?ml)$/.test(file));
  const runtimePatterns = [
    /Deno\.env\.get\(\s*["']([A-Z][A-Z0-9_]+)["']\s*\)/g,
    /process\.env\.([A-Z][A-Z0-9_]+)/g,
  ];
  for (const file of files) {
    const source = read(file);
    const patterns = [
      ...runtimePatterns,
      ...(/\.sh$/.test(file) ? [/\$\{([A-Z][A-Z0-9_]+)(?::[-+?][^}]*)?\}/g] : []),
      ...(/\.ya?ml$/.test(file) ? [/\$\{\{\s*secrets\.([A-Z][A-Z0-9_]+)\s*\}\}/g] : []),
    ];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const relative = path.relative(root, file).replaceAll("\\", "/").replace(/\/index\.ts$/, "");
        if (!references.has(match[1])) references.set(match[1], new Set());
        references.get(match[1]).add(relative);
      }
    }
  }
  const rows = [...references.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, refs]) => {
      const [owner, minted, revoke, reissue] = secretOwner(name);
      return `| \`${name}\` | ${owner} | ${[...refs].slice(0, 5).join(", ")}${refs.size > 5 ? ` (+${refs.size - 5})` : ""} | ${minted} | ${revoke} | ${reissue} |`;
    });
  return `# Security runtime secret/config inventory

Generated from secret/config-name references in Edge Functions, website API
handlers, backup scripts, and workflows. **This file contains names and recovery
instructions only; never put secret values here.**

Current count: **${references.size}** referenced secret/config names.

| Name | Account owner | Consumers | Minted/stored at | Revoke | Disaster-recovery re-issue |
|---|---|---|---|---|---|
${rows.join("\n")}

## Recovery rule

For every production secret, the founder-controlled offline vault must contain
either the encrypted value or a tested, provider-specific re-issue procedure.
Access to the Supabase account alone must not be sufficient to erase both the
running secret and its recovery path.
`;
}

function storageMarkdown() {
  const files = allFiles(root).filter((file) =>
    !file.includes(`${path.sep}.git${path.sep}`) &&
    !file.includes(`${path.sep}node_modules${path.sep}`) &&
    /\.(ts|tsx|js|mjs|sql)$/.test(file)
  );
  const buckets = new Map();
  const patterns = [
    /\.storage\s*\.from\(\s*["']([^"']+)["']\s*\)/g,
    /bucket_id\s*=\s*["']([^"']+)["']/g,
  ];
  for (const file of files) {
    const source = read(file);
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        if (!/^[a-z0-9][a-z0-9._-]{1,62}$/i.test(match[1])) continue;
        if (!buckets.has(match[1])) buckets.set(match[1], new Set());
        buckets.get(match[1]).add(path.relative(root, file).replaceAll("\\", "/"));
      }
    }
  }
  const liveSnapshotPath = path.join(outputRoot, "storage-bucket-live-snapshot.json");
  let liveSnapshot = null;
  if (fs.existsSync(liveSnapshotPath)) {
    liveSnapshot = JSON.parse(read(liveSnapshotPath));
    for (const bucket of liveSnapshot.buckets ?? []) {
      if (!buckets.has(bucket.name)) buckets.set(bucket.name, new Set());
      buckets.get(bucket.name).add("linked production Storage API snapshot");
    }
  }
  const rows = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, refs]) => `| \`${bucket}\` | ${[...refs].slice(0, 6).join(", ")} | daily object backup + manifest + checksum |`);
  return `# Storage bucket backup inventory

Statically detected bucket names. Before the first backup job is activated,
compare this list with \`storage.buckets\` in the linked project; the live list
wins.

Latest linked-project snapshot: **${liveSnapshot?.checked_at ?? "not captured"}**.

| Bucket | Evidence | Backup requirement |
|---|---|---|
${rows.join("\n")}
`;
}

write(path.join(outputRoot, "public-edge-function-inventory.md"), publicSurfaceMarkdown());
write(path.join(outputRoot, "secrets-inventory.md"), secretsMarkdown());
write(path.join(outputRoot, "storage-bucket-inventory.md"), storageMarkdown());

console.log("Generated security inventories in docs/security.");
