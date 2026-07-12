#!/usr/bin/env node
/**
 * One-time Google Wallet class setup for the Twofer Card (Generic pass class).
 * Creates (or verifies) the class `<issuerId>.twofer-card`. Idempotent.
 *
 * DAN-GATED: run only with explicit approval, after the Google Wallet issuer
 * account exists. Plan: docs/plans/native-wallet-pass-plan.md.
 *
 * Usage (PowerShell):
 *   $env:GOOGLE_WALLET_ISSUER_ID = "<issuer id>"
 *   $env:GOOGLE_WALLET_SERVICE_ACCOUNT_FILE = "C:\\path\\to\\service-account.json"
 *   node scripts/wallet-google-class-setup.mjs
 */

import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const CLASS_SUFFIX = "twofer-card";
const WALLET_OBJECTS_BASE = "https://walletobjects.googleapis.com/walletobjects/v1";
const WALLET_SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";

function fail(message) {
  console.error(`[wallet-class-setup] ${message}`);
  process.exit(1);
}

const issuerId = (process.env.GOOGLE_WALLET_ISSUER_ID ?? "").trim();
if (!issuerId) fail("GOOGLE_WALLET_ISSUER_ID is not set.");

const saFile = (process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_FILE ?? "").trim();
if (!saFile) fail("GOOGLE_WALLET_SERVICE_ACCOUNT_FILE is not set (path to the service-account JSON key).");

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(saFile, "utf8"));
} catch (err) {
  fail(`could not read/parse the service account file: ${err instanceof Error ? err.message : err}`);
}
if (!serviceAccount.client_email || !serviceAccount.private_key) {
  fail("service account JSON is missing client_email/private_key.");
}

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function signJwt(claims) {
  const signingInput = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(JSON.stringify(claims))}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(serviceAccount.private_key);
  return `${signingInput}.${signature.toString("base64url")}`;
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt({
    iss: serviceAccount.client_email,
    scope: WALLET_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) fail(`token exchange failed: HTTP ${response.status}`);
  const body = await response.json();
  if (!body.access_token) fail("token exchange returned no access_token.");
  return body.access_token;
}

async function main() {
  const classId = `${issuerId}.${CLASS_SUFFIX}`;
  const accessToken = await getAccessToken();
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

  const existing = await fetch(`${WALLET_OBJECTS_BASE}/genericClass/${encodeURIComponent(classId)}`, { headers });
  if (existing.ok) {
    console.log(`[wallet-class-setup] class ${classId} already exists — nothing to do.`);
    return;
  }
  if (existing.status !== 404) fail(`class lookup failed: HTTP ${existing.status}`);

  // Per-user content (title, code, barcode, colors) lives on the object; the
  // class stays minimal on purpose.
  const insert = await fetch(`${WALLET_OBJECTS_BASE}/genericClass`, {
    method: "POST",
    headers,
    body: JSON.stringify({ id: classId }),
  });
  if (!insert.ok) fail(`class insert failed: HTTP ${insert.status}`);
  console.log(`[wallet-class-setup] created class ${classId}.`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
