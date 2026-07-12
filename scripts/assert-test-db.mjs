// scripts/assert-test-db.mjs
//
// GUARD-RAIL: refuse to run any database test against anything other than the
// one approved Supabase TEST project. Every database script under scripts/ that
// talks to a remote MUST import { assertTestDb } and call it as its FIRST
// statement, before creating a client or reading a single row.
//
// Design: ALLOWLIST, not denylist. The only ref this file knows about is the
// approved test ref. The production ref is deliberately NOT present anywhere in
// this file — so it can never be leaked or accidentally targeted. Anything that
// is not exactly the test ref (production, an unknown project, a malformed URL,
// or a missing URL) is REFUSED. Fail closed.
//
// The Supabase URL is read from the environment (an explicit argument wins,
// otherwise EXPO_PUBLIC_SUPABASE_URL / SUPABASE_URL from process.env).
//
// Standalone proof:
//   node scripts/assert-test-db.mjs           # uses env; prints OK or refuses
//
// Exit code 0 = approved test project. Non-zero = refused.

// The ONLY project a database test is permitted to touch.
const APPROVED_TEST_REF = "zsuzrerdailvylccqtds";

// Supabase project URLs look like https://<ref>.supabase.co (also .in / .net).
// A project ref is 20 lowercase alphanumeric characters.
const SUPABASE_URL_RE = /^https?:\/\/([a-z0-9]{20})\.supabase\.(?:co|in|net)\b/i;

function extractRef(url) {
  if (typeof url !== "string") return null;
  const m = url.trim().match(SUPABASE_URL_RE);
  return m ? m[1].toLowerCase() : null;
}

// Never echo a full ref we are rejecting — mask it so a rejected (e.g. prod)
// ref can never end up verbatim in a log file or console capture.
function mask(ref) {
  if (!ref) return "<none>";
  if (ref.length <= 6) return `${ref[0]}***`;
  return `${ref.slice(0, 4)}…${ref.slice(-2)}`;
}

function refuse(reason) {
  const bar = "!".repeat(72);
  console.error(
    `\n${bar}\n` +
      `ABORTING: DATABASE TEST GUARD REFUSED TO RUN.\n` +
      `${reason}\n` +
      `Only the approved test project (${APPROVED_TEST_REF}) may be used for DB tests.\n` +
      `${bar}\n`
  );
  process.exit(1);
}

/**
 * Assert that the Supabase URL points at the approved test project.
 * Call this as the FIRST statement of any DB test script.
 * Returns { ref, url } on success; exits the process non-zero otherwise.
 */
export function assertTestDb(explicitUrl) {
  const url =
    explicitUrl ??
    process.env.EXPO_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    "";

  if (!url) {
    refuse("No Supabase URL found (checked argument, EXPO_PUBLIC_SUPABASE_URL, SUPABASE_URL).");
  }

  const ref = extractRef(url);
  if (!ref) {
    refuse(`Could not parse a Supabase project ref from the provided URL (masked host ref: ${mask(ref)}).`);
  }

  if (ref !== APPROVED_TEST_REF) {
    refuse(`URL targets project ref "${mask(ref)}", which is not the approved test project.`);
  }

  return { ref, url };
}

// ---- CLI / standalone proof mode -------------------------------------------
// Robust cross-platform "am I the entrypoint?" check (works on Windows paths).
const invokedDirectly =
  process.argv[1] &&
  import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const { ref } = assertTestDb();
  console.log(`OK: Supabase URL resolves to the approved test project ref "${ref}". Safe to proceed.`);
}
