const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const MOBILE_DIRS = ["app", "components", "lib/i18n/locales"];

const PROHIBITED = [
  /\bSubscribe\b/i,
  /\bPay with Stripe\b/i,
  /\bStart trial\b/i,
  /\bUpgrade\b/i,
  /\bPricing\b/i,
  /\bAdd payment method\b/i,
  /\bGo to website to purchase\b/i,
  /\bManage subscription\b/i,
];

const ALLOWED_PATH_PARTS = [
  "app/(tabs)/account/billing",
  "app/(tabs)/billing",
  "app/_layout.tsx",
  "components/billing-deeplink-handler.tsx",
  "lib/billing/",
];

function slash(value) {
  return value.split(path.sep).join("/");
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function isTextFile(file) {
  return /\.(tsx?|jsx?|json)$/.test(file);
}

function isAllowedFile(rel) {
  const normalized = slash(rel);
  if (normalized.includes(".test.")) return true;
  if (normalized.endsWith(".d.ts")) return true;
  return ALLOWED_PATH_PARTS.some((part) => normalized.startsWith(part));
}

function flattenJson(value, prefix = "", out = []) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flattenJson(child, prefix ? `${prefix}.${key}` : key, out);
    }
  } else if (typeof value === "string") {
    out.push({ key: prefix, value });
  }
  return out;
}

function scanText(rel, text, failures) {
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of PROHIBITED) {
      if (pattern.test(line)) {
        failures.push(`${rel}:${index + 1}: ${line.trim()}`);
      }
    }
  });
}

function scanLocale(rel, text, failures) {
  const data = JSON.parse(text);
  for (const item of flattenJson(data)) {
    if (item.key.startsWith("billing.") || item.key.startsWith("billingManage.")) continue;
    for (const pattern of PROHIBITED) {
      if (pattern.test(item.value)) {
        failures.push(`${rel}:${item.key}: ${item.value}`);
      }
    }
  }
}

const failures = [];
for (const dir of MOBILE_DIRS) {
  for (const file of walk(path.join(ROOT, dir))) {
    const rel = slash(path.relative(ROOT, file));
    if (!isTextFile(file) || isAllowedFile(rel)) continue;
    const text = fs.readFileSync(file, "utf8");
    if (rel.startsWith("lib/i18n/locales/") && rel.endsWith(".json")) {
      scanLocale(rel, text, failures);
    } else {
      scanText(rel, text, failures);
    }
  }
}

if (failures.length > 0) {
  console.error("Mobile production copy guard failed. Remove or dev-gate payment purchase language:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Mobile production copy guard passed.");
