/**
 * Native wallet pass ("Twofer Card") — Apple .pkpass builder (Deno/edge).
 * Assembles pass.json + images + manifest.json (SHA-1 per PassKit spec), signs
 * the manifest with a PKCS#7 detached signature (Pass Type cert + WWDR
 * intermediate, SHA-256 signer digest — proven with openssl), and zips the
 * result into a .pkpass. Uses node-forge + fflate via esm.sh (same CDN the
 * other edge functions use). Pure crypto lives here; the pass.json shape is in
 * apple-pass-json.ts (vitest-covered).
 */

// @ts-ignore esm.sh default export
import forge from "https://esm.sh/node-forge@1.4.0";
import { zipSync } from "https://esm.sh/fflate@0.8.2";
import { buildApplePassJson } from "./apple-pass-json.ts";
import { applePassImages } from "./apple-pass-images.ts";
import type { WalletPassContent } from "./wallet-pass-content.ts";

function bytesToBinary(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

function binaryToBytes(bin: string): Uint8Array {
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function sha1Hex(bytes: Uint8Array): string {
  const md = forge.md.sha1.create();
  md.update(bytesToBinary(bytes));
  return md.digest().toHex();
}

/** PKCS#7 detached signature of the manifest string. Returns DER bytes. */
function signManifest(manifestStr: string, certPem: string, keyPem: string, wwdrPem: string): Uint8Array {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifestStr, "utf8");
  p7.addCertificate(certPem);
  p7.addCertificate(wwdrPem);
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(keyPem),
    certificate: certPem,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign({ detached: true });
  const der: string = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return binaryToBytes(der);
}

export type BuildPkpassOptions = {
  serialNumber: string;
  passTypeId: string;
  teamId: string;
  certPem: string;
  keyPem: string;
  wwdrPem: string;
  webServiceURL?: string | null;
  authenticationToken?: string | null;
};

/** Build a signed .pkpass (zip) for the given card content. Returns the file bytes. */
export function buildSignedPkpass(content: WalletPassContent, opts: BuildPkpassOptions): Uint8Array {
  const enc = new TextEncoder();
  const passJson = JSON.stringify(
    buildApplePassJson(content, {
      serialNumber: opts.serialNumber,
      passTypeId: opts.passTypeId,
      teamId: opts.teamId,
      webServiceURL: opts.webServiceURL ?? null,
      authenticationToken: opts.authenticationToken ?? null,
    }),
  );

  // All files that go into the bundle (order not significant).
  const files: Record<string, Uint8Array> = { "pass.json": enc.encode(passJson) };
  for (const [name, bytes] of Object.entries(applePassImages())) files[name] = bytes;

  // manifest.json = SHA-1 of every file above.
  const manifest: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) manifest[name] = sha1Hex(bytes);
  const manifestStr = JSON.stringify(manifest);
  files["manifest.json"] = enc.encode(manifestStr);

  // signature = PKCS#7 detached signature of manifest.json.
  files["signature"] = signManifest(manifestStr, opts.certPem, opts.keyPem, opts.wwdrPem);

  return zipSync(files);
}
