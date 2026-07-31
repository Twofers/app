// Minimal READ-ONLY Postgres client — catalog verification for security work.
//
// WHY THIS EXISTS
//   Security review needs to read the LIVE catalog (pg_policies, table_privileges,
//   relrowsecurity, ...) rather than trust what the migration files say. The
//   repository has no Postgres driver dependency, psql is not installed on the
//   founder machine, and `supabase db dump` needs Docker (explicitly out of
//   bounds here). This speaks the Postgres v3 wire protocol directly using only
//   Node built-ins: TLS + SCRAM-SHA-256 + the simple query protocol.
//
// SAFETY BY CONSTRUCTION
//   - TLS is mandatory. If the server answers SSLRequest with anything but 'S',
//     the connection is aborted; the password is never put on the wire in clear.
//   - Only ONE statement per call, and only SELECT / WITH / TABLE / SHOW /
//     EXPLAIN. Anything else — DML, DDL, GRANT, multiple statements — is
//     refused before a byte is sent.
//   - The startup message also asks for default_transaction_read_only=on as a
//     second layer. Measured caveat: connecting through the Supavisor pooler,
//     `current_setting('transaction_read_only')` still reports "off" — the
//     pooler does not forward that startup parameter. So the statement guard
//     above is the control that is actually enforced; treat the read-only
//     session parameter as best-effort only.
//
// USAGE
//   PG_READ_URL=postgresql://user:pass@host:5432/postgres \
//     node scripts/security/pg-read.mjs "select 1" [--json]
//   node scripts/security/pg-read.mjs --file query.sql --json
//
// The connection string is read from PG_READ_URL (or --url) and is never echoed.

import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";
import fs from "node:fs";

const SSL_REQUEST_CODE = 80877103;
const PROTOCOL_VERSION_3 = 196608;
const TIMEOUT_MS = Number(process.env.PG_READ_TIMEOUT_MS ?? 30000);

// A single read statement. Semicolons are allowed only as a trailing terminator.
const READ_STATEMENT = /^\s*(select|with|table|show|explain)\b/i;

export function assertReadOnlyStatement(sql) {
  if (typeof sql !== "string" || sql.trim() === "") {
    throw new Error("Refusing to run an empty statement.");
  }
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (trimmed.includes(";")) {
    throw new Error("Refusing to run more than one statement in a single call.");
  }
  if (!READ_STATEMENT.test(trimmed)) {
    throw new Error(
      "Refusing to run a statement that does not begin with SELECT / WITH / TABLE / SHOW / EXPLAIN."
    );
  }
  return trimmed;
}

function int32(value) {
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(value, 0);
  return buf;
}

function frame(kind, body) {
  const header = Buffer.alloc(kind ? 5 : 4);
  let offset = 0;
  if (kind) header.write(kind, offset++, "latin1");
  header.writeInt32BE(body.length + 4, offset);
  return Buffer.concat([header, body]);
}

function cstring(value) {
  return Buffer.concat([Buffer.from(value, "utf8"), Buffer.from([0])]);
}

/** Split a stream buffer into complete { kind, body } messages. */
function drainMessages(buffer) {
  const messages = [];
  let offset = 0;
  while (buffer.length - offset >= 5) {
    const length = buffer.readInt32BE(offset + 1);
    if (buffer.length - offset < length + 1) break;
    messages.push({
      kind: String.fromCharCode(buffer[offset]),
      body: buffer.slice(offset + 5, offset + 1 + length),
    });
    offset += length + 1;
  }
  return { messages, rest: buffer.slice(offset) };
}

function decodeErrorFields(body) {
  const fields = {};
  let offset = 0;
  while (offset < body.length && body[offset] !== 0) {
    const code = String.fromCharCode(body[offset]);
    const end = body.indexOf(0, offset + 1);
    if (end === -1) break;
    fields[code] = body.slice(offset + 1, end).toString("utf8");
    offset = end + 1;
  }
  return fields;
}

function scramClientProof({ password, salt, iterations, authMessage }) {
  const saltedPassword = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = crypto.createHmac("sha256", saltedPassword).update("Client Key").digest();
  const storedKey = crypto.createHash("sha256").update(clientKey).digest();
  const clientSignature = crypto.createHmac("sha256", storedKey).update(authMessage).digest();
  const proof = Buffer.alloc(clientKey.length);
  for (let index = 0; index < clientKey.length; index += 1) {
    proof[index] = clientKey[index] ^ clientSignature[index];
  }
  return proof;
}

function connectPlain(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(TIMEOUT_MS);
    socket.once("connect", () => resolve(socket));
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`timed out connecting to ${host}:${port}`));
    });
    socket.once("error", (error) => {
      socket.destroy();
      reject(error);
    });
  });
}

/** Upgrade to TLS or fail — never continue in the clear. */
async function connectSecure(host, port) {
  const raw = await connectPlain(host, port);
  raw.write(frame(null, int32(SSL_REQUEST_CODE)));
  const reply = await new Promise((resolve, reject) => {
    raw.once("data", resolve);
    raw.once("error", reject);
  });
  if (String.fromCharCode(reply[0]) !== "S") {
    raw.destroy();
    throw new Error("Server refused TLS on this endpoint; aborting before authentication.");
  }
  // This connection carries a database password, so the certificate is
  // VERIFIED BY DEFAULT. Supabase presents a chain from its own
  // "Supabase Root 2021 CA", which is absent from the Node trust store, so
  // point PG_READ_ROOT_CERT at that CA (Supabase dashboard -> Settings ->
  // Database -> SSL configuration) to authenticate the server as well as
  // encrypt to it.
  //
  // Skipping verification is possible but must be chosen explicitly by setting
  // PG_READ_INSECURE_TLS=true. Encryption without authentication does not stop
  // a machine-in-the-middle from presenting its own certificate and capturing
  // the password, so it is never the default and is announced when used.
  const rootCertPath = process.env.PG_READ_ROOT_CERT;
  const insecure = process.env.PG_READ_INSECURE_TLS === "true";
  let ca;
  if (rootCertPath) {
    ca = fs.readFileSync(rootCertPath);
  } else if (!insecure) {
    raw.destroy();
    throw new Error(
      "Refusing to send a database password over an unverified TLS connection.\n" +
        "Set PG_READ_ROOT_CERT to the Supabase CA certificate, or set\n" +
        "PG_READ_INSECURE_TLS=true to accept an unauthenticated channel deliberately.",
    );
  } else {
    console.error("WARNING: PG_READ_INSECURE_TLS=true — the server certificate is NOT verified.");
  }

  return new Promise((resolve, reject) => {
    const secured = tls.connect(
      {
        socket: raw,
        servername: host,
        ...(ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false }),
      },
      () => resolve(secured)
    );
    secured.setTimeout(TIMEOUT_MS);
    secured.once("error", reject);
  });
}

/**
 * Run one read-only statement and return { fields, rows }.
 * Rows are arrays of strings (Postgres text format) — no type coercion, so
 * catalog output is reported exactly as the server rendered it.
 */
export async function readQuery(connectionString, sql) {
  const statement = assertReadOnlyStatement(sql);
  const url = new URL(connectionString);
  const host = decodeURIComponent(url.hostname);
  const port = Number(url.port || 5432);
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres";

  const socket = await connectSecure(host, port);
  let buffer = Buffer.alloc(0);
  const waiters = [];
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const { messages, rest } = drainMessages(buffer);
    buffer = rest;
    for (const message of messages) {
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(message);
      else pending.push(message);
    }
  });
  const pending = [];
  const nextMessage = () =>
    new Promise((resolve, reject) => {
      if (pending.length > 0) return resolve(pending.shift());
      waiters.push({ resolve, reject });
      socket.once("error", reject);
      socket.once("close", () => reject(new Error("connection closed unexpectedly")));
    });

  const fail = (message, fields) => {
    socket.destroy();
    const detail = fields ? ` (${fields.C ?? "?"} ${fields.M ?? ""})` : "";
    return new Error(`${message}${detail}`);
  };

  try {
    socket.write(
      frame(
        null,
        Buffer.concat([
          int32(PROTOCOL_VERSION_3),
          cstring("user"),
          cstring(user),
          cstring("database"),
          cstring(database),
          cstring("application_name"),
          cstring("twofer-security-catalog-read"),
          cstring("default_transaction_read_only"),
          cstring("on"),
          Buffer.from([0]),
        ])
      )
    );

    // --- SCRAM-SHA-256 -------------------------------------------------------
    let message = await nextMessage();
    if (message.kind === "E") throw fail("Startup rejected", decodeErrorFields(message.body));
    if (message.kind !== "R") throw fail(`Unexpected reply "${message.kind}" during authentication`);
    let authType = message.body.readInt32BE(0);
    if (authType !== 10) {
      throw fail(`Server requested authentication method ${authType}; only SCRAM-SHA-256 is supported`);
    }

    const clientNonce = crypto.randomBytes(18).toString("base64");
    const clientFirstBare = `n=,r=${clientNonce}`;
    const initialResponse = Buffer.from(`n,,${clientFirstBare}`, "utf8");
    socket.write(
      frame(
        "p",
        Buffer.concat([cstring("SCRAM-SHA-256"), int32(initialResponse.length), initialResponse])
      )
    );

    message = await nextMessage();
    if (message.kind === "E") throw fail("SCRAM rejected", decodeErrorFields(message.body));
    authType = message.body.readInt32BE(0);
    if (authType !== 11) throw fail(`Expected SASLContinue, received ${authType}`);
    const serverFirst = message.body.slice(4).toString("utf8");
    const attributes = Object.fromEntries(
      serverFirst.split(",").map((pair) => [pair.slice(0, 1), pair.slice(2)])
    );
    const clientFinalWithoutProof = `c=biws,r=${attributes.r}`;
    const proof = scramClientProof({
      password,
      salt: Buffer.from(attributes.s, "base64"),
      iterations: Number(attributes.i),
      authMessage: `${clientFirstBare},${serverFirst},${clientFinalWithoutProof}`,
    });
    socket.write(
      frame("p", Buffer.from(`${clientFinalWithoutProof},p=${proof.toString("base64")}`, "utf8"))
    );

    message = await nextMessage();
    if (message.kind === "E") throw fail("Authentication failed", decodeErrorFields(message.body));
    authType = message.body.readInt32BE(0);
    if (authType === 12) {
      message = await nextMessage();
      if (message.kind === "E") throw fail("Authentication failed", decodeErrorFields(message.body));
      authType = message.body.readInt32BE(0);
    }
    if (authType !== 0) throw fail(`Authentication did not complete (code ${authType})`);

    // Drain ParameterStatus/BackendKeyData until the server is ready.
    for (;;) {
      message = await nextMessage();
      if (message.kind === "Z") break;
      if (message.kind === "E") throw fail("Session setup failed", decodeErrorFields(message.body));
    }

    // --- Simple query --------------------------------------------------------
    socket.write(frame("Q", cstring(statement)));
    const result = { fields: [], rows: [] };
    let error = null;
    for (;;) {
      message = await nextMessage();
      if (message.kind === "T") {
        const count = message.body.readInt16BE(0);
        let offset = 2;
        result.fields = [];
        for (let index = 0; index < count; index += 1) {
          const end = message.body.indexOf(0, offset);
          result.fields.push(message.body.slice(offset, end).toString("utf8"));
          offset = end + 1 + 18;
        }
      } else if (message.kind === "D") {
        const count = message.body.readInt16BE(0);
        let offset = 2;
        const row = [];
        for (let index = 0; index < count; index += 1) {
          const length = message.body.readInt32BE(offset);
          offset += 4;
          if (length === -1) {
            row.push(null);
          } else {
            row.push(message.body.slice(offset, offset + length).toString("utf8"));
            offset += length;
          }
        }
        result.rows.push(row);
      } else if (message.kind === "E") {
        error = decodeErrorFields(message.body);
      } else if (message.kind === "Z") {
        break;
      }
    }
    socket.end();
    if (error) throw new Error(`Query failed (${error.C ?? "?"} ${error.M ?? ""})`);
    return result;
  } finally {
    socket.destroy();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const urlIndex = args.indexOf("--url");
  const fileIndex = args.indexOf("--file");
  const connectionString =
    urlIndex !== -1 ? args[urlIndex + 1] : process.env.PG_READ_URL;
  if (!connectionString) {
    console.error("Set PG_READ_URL (or pass --url) to a Postgres connection string.");
    process.exit(2);
  }
  const sql =
    fileIndex !== -1
      ? fs.readFileSync(args[fileIndex + 1], "utf8")
      : args.find((value, index) => !value.startsWith("--") && args[index - 1] !== "--url" && args[index - 1] !== "--file");
  if (!sql) {
    console.error('Pass a statement: node scripts/security/pg-read.mjs "select 1"');
    process.exit(2);
  }

  const { fields, rows } = await readQuery(connectionString, sql);
  if (json) {
    console.log(
      JSON.stringify(
        rows.map((row) => Object.fromEntries(fields.map((field, index) => [field, row[index]]))),
        null,
        2
      )
    );
  } else {
    console.log(fields.join(" | "));
    console.log("-".repeat(60));
    for (const row of rows) console.log(row.map((value) => (value === null ? "∅" : value)).join(" | "));
    console.log(`(${rows.length} rows)`);
  }
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  await main();
}
