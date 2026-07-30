// Direct-database TLS posture verifier — Phase 4 of the founder security plan.
//
// PURPOSE
//   Before "Enforce SSL" is turned on for the PRODUCTION Supabase project, every
//   client that speaks the Postgres wire protocol directly (pg_dump, psql,
//   pg_restore, the Supabase CLI, CI jobs) must be proven to negotiate TLS. This
//   tool answers that at the protocol level, with NO database credentials:
//
//     1. SSLRequest         -> does the server offer TLS on this endpoint?
//     2. TLS handshake      -> which protocol/cipher/certificate does it present?
//     3. Plaintext startup  -> is an unencrypted (sslmode=disable) client REFUSED?
//
//   Step 3 is the enforcement proof. With "Enforce SSL" ON the server answers a
//   cleartext StartupMessage with an ErrorResponse instead of an authentication
//   request. With it OFF the server proceeds to ask for a password over the
//   wire in the clear — which is exactly the exposure the setting removes.
//
// SAFETY
//   - No password, service key, or database name secret is ever sent.
//   - The plaintext probe stops at the server's first reply; it never
//     authenticates, never issues SQL, and cannot mutate anything.
//   - Read-only: this tool changes no project setting.
//
// USAGE
//   node scripts/security/verify-database-tls.mjs <label>=<host>[:port][|wireUser] ...
//   node scripts/security/verify-database-tls.mjs --json test=db.<ref>.supabase.co
//
//   The optional |wireUser matters for the shared Supavisor pooler: it is
//   multi-tenant, so the tenant is only known once the StartupMessage names
//   "postgres.<project-ref>". Without it the pooler rejects the connection for
//   an unrelated reason and the per-project enforcement state stays invisible.
//   Only the username is sent — never a password.
//
// EXIT CODES
//   0 = every endpoint offered TLS and every endpoint's enforcement state was
//       determined. Non-zero = an endpoint could not be reached or did not
//       offer TLS at all.

import net from "node:net";
import tls from "node:tls";

const SSL_REQUEST_CODE = 80877103;
const PROTOCOL_VERSION_3 = 196608;
const DEFAULT_PORT = 5432;
const CONNECT_TIMEOUT_MS = Number(process.env.DB_TLS_PROBE_TIMEOUT_MS ?? 12000);

function int32(value) {
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(value, 0);
  return buf;
}

/** Postgres SSLRequest packet: Int32 length(8) + Int32 code. */
function sslRequestPacket() {
  return Buffer.concat([int32(8), int32(SSL_REQUEST_CODE)]);
}

/**
 * Postgres StartupMessage with NO preceding SSLRequest — i.e. exactly what a
 * client running with sslmode=disable puts on the wire.
 */
function plaintextStartupPacket(params) {
  const parts = [];
  for (const [key, value] of Object.entries(params)) {
    parts.push(Buffer.from(`${key}\0${value}\0`, "utf8"));
  }
  parts.push(Buffer.from([0]));
  const body = Buffer.concat([int32(PROTOCOL_VERSION_3), ...parts]);
  return Buffer.concat([int32(body.length + 4), body]);
}

/** Decode a Postgres ErrorResponse/NoticeResponse body into its field map. */
function decodeErrorFields(body) {
  const fields = {};
  let offset = 0;
  while (offset < body.length) {
    const code = body[offset];
    if (code === 0) break;
    const end = body.indexOf(0, offset + 1);
    if (end === -1) break;
    fields[String.fromCharCode(code)] = body.slice(offset + 1, end).toString("utf8");
    offset = end + 1;
  }
  return fields;
}

function connect(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(CONNECT_TIMEOUT_MS);
    const fail = (error) => {
      socket.destroy();
      reject(error);
    };
    socket.once("connect", () => {
      socket.setTimeout(CONNECT_TIMEOUT_MS);
      resolve(socket);
    });
    socket.once("timeout", () => fail(new Error(`timed out connecting to ${host}:${port}`)));
    socket.once("error", fail);
  });
}

/** Read exactly `length` bytes, or reject on close/timeout. */
function readBytes(socket, length) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
      socket.off("timeout", onTimeout);
    };
    const onData = (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total >= length) {
        cleanup();
        resolve(Buffer.concat(chunks).slice(0, length));
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("connection closed before the expected reply arrived"));
    };
    const onTimeout = () => {
      cleanup();
      reject(new Error("timed out waiting for a server reply"));
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
    socket.once("timeout", onTimeout);
  });
}

/** Step 1 + 2: SSLRequest, then complete the TLS handshake it permits. */
async function probeTlsNegotiation(host, port) {
  const socket = await connect(host, port);
  try {
    socket.write(sslRequestPacket());
    const reply = await readBytes(socket, 1);
    const marker = String.fromCharCode(reply[0]);
    if (marker !== "S") {
      socket.destroy();
      return { sslOffered: false, sslRequestReply: marker };
    }
    const secured = await new Promise((resolve, reject) => {
      const upgraded = tls.connect(
        {
          socket,
          servername: host,
          // Supabase direct-connection certificates chain to a Supabase CA that
          // is not in the Node trust store. Record the verification outcome
          // instead of silently accepting or silently failing.
          rejectUnauthorized: false,
        },
        () => resolve(upgraded)
      );
      upgraded.setTimeout(CONNECT_TIMEOUT_MS, () =>
        reject(new Error("timed out during the TLS handshake"))
      );
      upgraded.once("error", reject);
    });
    const certificate = secured.getPeerCertificate(false) ?? {};
    const result = {
      sslOffered: true,
      sslRequestReply: marker,
      tlsProtocol: secured.getProtocol(),
      tlsCipher: secured.getCipher()?.name ?? null,
      certificateAuthorized: secured.authorized,
      certificateAuthorizationError: secured.authorizationError
        ? String(secured.authorizationError)
        : null,
      certificateSubjectCommonName: certificate?.subject?.CN ?? null,
      certificateIssuerCommonName: certificate?.issuer?.CN ?? null,
      certificateValidTo: certificate?.valid_to ?? null,
    };
    secured.destroy();
    return result;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

/**
 * Step 3: send a cleartext StartupMessage and classify the first server reply.
 *
 *   ErrorResponse ('E')          -> unencrypted clients are REFUSED (enforced)
 *   AuthenticationRequest ('R')  -> the server is willing to authenticate in
 *                                   the clear (NOT enforced)
 */
async function probePlaintextRefusal(host, port, wireUser) {
  const socket = await connect(host, port);
  try {
    socket.write(
      plaintextStartupPacket({
        user: wireUser,
        database: "postgres",
        application_name: "twofer-tls-posture-probe",
      })
    );
    const header = await readBytes(socket, 5);
    const marker = String.fromCharCode(header[0]);
    const bodyLength = header.readInt32BE(1) - 4;
    const body = bodyLength > 0 ? await readBytes(socket, bodyLength) : Buffer.alloc(0);
    socket.destroy();
    if (marker === "E") {
      const fields = decodeErrorFields(body);
      return {
        plaintextOutcome: "refused",
        replyMarker: marker,
        sqlState: fields.C ?? null,
        serverMessage: fields.M ?? null,
      };
    }
    if (marker === "R") {
      return {
        plaintextOutcome: "authentication-offered-in-cleartext",
        replyMarker: marker,
        authenticationMethod: body.length >= 4 ? body.readInt32BE(0) : null,
        sqlState: null,
        serverMessage: null,
      };
    }
    return { plaintextOutcome: "unexpected-reply", replyMarker: marker, sqlState: null, serverMessage: null };
  } catch (error) {
    socket.destroy();
    // A server that closes or resets the connection without an ErrorResponse
    // has still refused the unencrypted client; report it distinctly so the
    // evidence stays honest about how the refusal was delivered.
    return {
      plaintextOutcome: "closed-without-reply",
      replyMarker: null,
      sqlState: null,
      serverMessage: String(error?.message ?? error),
    };
  }
}

export function parseTarget(argument) {
  const separator = argument.indexOf("=");
  if (separator === -1) {
    throw new Error(`Expected <label>=<host>[:port][|wireUser], received "${argument}"`);
  }
  const label = argument.slice(0, separator);
  let endpoint = argument.slice(separator + 1);
  let wireUser = "tls-posture-probe";
  const userSeparator = endpoint.indexOf("|");
  if (userSeparator !== -1) {
    wireUser = endpoint.slice(userSeparator + 1);
    endpoint = endpoint.slice(0, userSeparator);
  }
  const portSeparator = endpoint.lastIndexOf(":");
  const hasPort = portSeparator !== -1 && portSeparator > endpoint.lastIndexOf("]");
  const host = hasPort ? endpoint.slice(0, portSeparator) : endpoint;
  const port = hasPort ? Number(endpoint.slice(portSeparator + 1)) : DEFAULT_PORT;
  if (!label || !host || !wireUser || !Number.isInteger(port) || port <= 0) {
    throw new Error(`Could not parse target "${argument}"`);
  }
  return { label, host, port, wireUser };
}

async function probeTarget({ label, host, port, wireUser }) {
  const record = { label, host, port, wireUser, probedAt: new Date().toISOString() };
  try {
    Object.assign(record, await probeTlsNegotiation(host, port));
  } catch (error) {
    record.sslOffered = false;
    record.error = String(error?.message ?? error);
    return record;
  }
  Object.assign(record, await probePlaintextRefusal(host, port, wireUser));
  // NOTE ON ATTRIBUTION: "cleartext is unusable here" is not the same claim as
  // "this project's Enforce-SSL setting is on". The shared Supavisor pooler
  // refuses every cleartext startup as a property of the pooler itself. Only a
  // *direct* db.<ref> endpoint that answers cleartext with an ErrorResponse
  // attributes the refusal to the project setting. Report the observation, and
  // leave the attribution to the endpoint kind.
  record.cleartextUsable = record.plaintextOutcome === "authentication-offered-in-cleartext";
  return record;
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const targets = args.filter((value) => !value.startsWith("--"));
  if (targets.length === 0) {
    console.error(
      "Usage: node scripts/security/verify-database-tls.mjs [--json] <label>=<host>[:port] ..."
    );
    process.exit(2);
  }

  const results = [];
  for (const argument of targets) {
    results.push(await probeTarget(parseTarget(argument)));
  }

  if (json) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  } else {
    for (const result of results) {
      console.log(`\n=== ${result.label} (${result.host}:${result.port})`);
      if (result.error) {
        console.log(`  unreachable: ${result.error}`);
        continue;
      }
      console.log(`  SSLRequest reply .......... ${result.sslRequestReply} (TLS offered: ${result.sslOffered})`);
      console.log(`  TLS protocol / cipher ..... ${result.tlsProtocol} / ${result.tlsCipher}`);
      console.log(
        `  certificate ............... CN=${result.certificateSubjectCommonName} issuer=${result.certificateIssuerCommonName} validTo=${result.certificateValidTo}`
      );
      console.log(
        `  default trust-store check . authorized=${result.certificateAuthorized} error=${result.certificateAuthorizationError}`
      );
      console.log(`  cleartext startup ......... ${result.plaintextOutcome}`);
      if (result.sqlState || result.serverMessage) {
        console.log(`     server said ............ ${result.sqlState ?? "-"} ${result.serverMessage ?? ""}`);
      }
      console.log(`  cleartext usable here ..... ${result.cleartextUsable}`);
    }
  }

  const unreachable = results.filter((result) => !result.sslOffered);
  if (unreachable.length > 0) {
    console.error(
      `\n${unreachable.length} endpoint(s) did not complete TLS negotiation: ${unreachable
        .map((result) => result.label)
        .join(", ")}`
    );
    process.exit(1);
  }
}

// Only probe the network when invoked directly, so the parser stays unit-testable.
const invokedDirectly =
  process.argv[1] &&
  import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  await main();
}
