#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const manifestPath = join(process.cwd(), "docs", "ai-poster-core-lock.json");

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read AI poster core lock manifest at ${path}: ${message}`);
  }
}

function normalizedSha256(path) {
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const manifest = readJson(manifestPath);
const files = Array.isArray(manifest.files) ? manifest.files : [];
const failures = [];

if (files.length === 0) {
  failures.push("Manifest has no locked files.");
}

for (const entry of files) {
  const filePath = typeof entry.path === "string" ? entry.path : "";
  const expectedHash = typeof entry.sha256 === "string" ? entry.sha256 : "";
  const approvedBy = typeof entry.approvedBy === "string" ? entry.approvedBy.trim() : "";
  const approvalRef = typeof entry.approvalRef === "string" ? entry.approvalRef.trim() : "";
  const rationale = typeof entry.rationale === "string" ? entry.rationale.trim() : "";

  if (!filePath || !expectedHash || !approvedBy || !approvalRef || !rationale) {
    failures.push(`${filePath || "<missing path>"} is missing required lock metadata.`);
    continue;
  }

  const absolutePath = join(process.cwd(), filePath);
  if (!existsSync(absolutePath)) {
    failures.push(`${filePath} is locked but no longer exists.`);
    continue;
  }

  const actualHash = normalizedSha256(absolutePath);
  if (actualHash !== expectedHash) {
    failures.push(`${filePath} changed: expected ${expectedHash}, got ${actualHash}`);
  }
}

if (failures.length > 0) {
  console.error("\n[ai-poster-core-lock] Protected AI poster/ad-generation files changed.\n");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error(`
This feature is owner-approval gated.

Before changing locked AI poster files:
1. Stop and notify Dan.
2. List each file that will change.
3. Explain the exact behavior/UI/deploy impact for each file.
4. Get Dan's explicit approval for each file individually.
5. Update docs/ai-poster-core-lock.json with the new hash and approval reference.
6. Re-run npm run gate:ai-poster-lock plus the AI/poster validation checks.
`);
  process.exit(1);
}

console.log(`[ai-poster-core-lock] ${files.length} protected files match locked hashes.`);
