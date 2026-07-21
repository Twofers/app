/**
 * Centralized OpenAI API-key selection with prepaid -> existing fallback.
 *
 * Every server-side OpenAI request goes through `fetchOpenAiWithFallback`, which:
 *  1. Tries `OPENAI_API_KEY_PREPAID` first.
 *  2. Falls back to `OPENAI_API_KEY` ONLY when the prepaid attempt returns an
 *     eligible auth/access/quota status (401, 403, 404, 429) — see
 *     `isOpenAiKeyFallbackStatus`.
 *  3. Never retries malformed/validation failures (400/422) and never key-retries
 *     a thrown error (timeout/network) or a server error (5xx) — those preserve the
 *     caller's existing behavior exactly.
 *  4. Logs only which configured source served the request:
 *     "openai_prepaid" or "openai_existing_fallback". Key material is never logged,
 *     returned, or otherwise surfaced.
 *
 * The keys are read from the environment only. Callers must NOT set an
 * `Authorization` header themselves — the wrapper injects it.
 */

export type OpenAiKeySource = "openai_prepaid" | "openai_existing_fallback";

export type OpenAiEnvReader = {
  get(name: string): string | undefined | null;
};

export type OpenAiKeyCandidate = {
  source: OpenAiKeySource;
  key: string;
};

/**
 * Returns the edge-runtime env reader, or null under node/vitest where there is no
 * `Deno` global. `typeof Deno` never throws for an undeclared identifier, so this is
 * safe to import from unit-tested modules.
 */
function edgeEnvOrNull(): OpenAiEnvReader | null {
  try {
    return typeof Deno !== "undefined" ? Deno.env : null;
  } catch {
    return null;
  }
}

function trimmedValue(value: string | undefined | null): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolve the ordered OpenAI key candidates. Prepaid is always first; the existing
 * key is the fallback. When only one key is configured, it is the sole candidate.
 *
 * `existingKeyOverride` lets a caller that already resolved `OPENAI_API_KEY` (e.g. via
 * dependency injection in tests) pass it straight through without env access. Prepaid
 * is still read from env so production prefers it even when a caller injects the
 * existing key.
 */
export function resolveOpenAiKeyCandidates(
  opts: { env?: OpenAiEnvReader | null; existingKeyOverride?: string | null } = {},
): OpenAiKeyCandidate[] {
  const env = opts.env ?? edgeEnvOrNull();
  const prepaid = trimmedValue(env?.get("OPENAI_API_KEY_PREPAID"));
  const existing = trimmedValue(
    opts.existingKeyOverride != null ? opts.existingKeyOverride : env?.get("OPENAI_API_KEY"),
  );

  const candidates: OpenAiKeyCandidate[] = [];
  if (prepaid) {
    candidates.push({ source: "openai_prepaid", key: prepaid });
  }
  // Only add the existing key when present AND distinct, so a single shared value
  // never issues the request twice or mislabels the source.
  if (existing && existing !== prepaid) {
    candidates.push({ source: "openai_existing_fallback", key: existing });
  }
  return candidates;
}

/** True when at least one OpenAI key (prepaid or existing) is configured. */
export function hasConfiguredOpenAiKey(
  opts: { env?: OpenAiEnvReader | null; existingKeyOverride?: string | null } = {},
): boolean {
  return resolveOpenAiKeyCandidates(opts).length > 0;
}

/**
 * HTTP statuses on which the prepaid key is abandoned and the request is retried with
 * the existing key:
 *  - 401 authentication (revoked / invalid key)
 *  - 403 access or billing hard-limit
 *  - 404 model or project access (we only ever hit fixed valid endpoints, so any 404
 *        here means the key's account/project cannot reach the model)
 *  - 429 quota exhausted or rate limited
 *
 * 400/422 (malformed request / validation) are intentionally NOT eligible — the same
 * request fails identically on the other key, so it must never be retried. 5xx server
 * errors and thrown timeout/network failures are also not key-fallback triggers; they
 * flow through the caller's existing error handling unchanged.
 */
export function isOpenAiKeyFallbackStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 404 || status === 429;
}

/** Thrown when neither `OPENAI_API_KEY_PREPAID` nor `OPENAI_API_KEY` is configured. */
export class OpenAiKeyUnavailableError extends Error {
  constructor() {
    super("No OpenAI API key is configured.");
    this.name = "OpenAiKeyUnavailableError";
  }
}

export type OpenAiFetchResult = {
  response: Response;
  /** Which configured source ultimately served the returned response. */
  source: OpenAiKeySource;
};

function logKeyEvent(params: {
  logTag: string;
  event: string;
  source: OpenAiKeySource;
  status: number;
  fellBackFrom?: OpenAiKeySource;
}): void {
  // Only the source label + status are emitted — never any key material.
  console.log(
    JSON.stringify({
      tag: params.logTag,
      event: params.event,
      source: params.source,
      status: params.status,
      ...(params.fellBackFrom ? { fell_back_from: params.fellBackFrom } : {}),
    }),
  );
}

/**
 * Perform an OpenAI request with prepaid -> existing key fallback.
 *
 * - Injects `Authorization: Bearer <key>` per attempt; callers must not set it.
 * - Tries prepaid first; on an eligible status (see `isOpenAiKeyFallbackStatus`)
 *   retries once with the existing key. Returns the first success / non-eligible
 *   response without retrying.
 * - Thrown errors (timeout/network) propagate unchanged — no key retry.
 * - Logs only which source handled the request.
 *
 * Pass `buildBody` when the body is single-use (FormData / streams): it is invoked
 * once per attempt to produce a fresh body. For string/JSON bodies, set `init.body`
 * and omit `buildBody`.
 */
export async function fetchOpenAiWithFallback(params: {
  url: string;
  init: RequestInit;
  logTag: string;
  /** Base event name; the retry transition is logged as `${event}_fallback`. */
  event?: string;
  candidates?: OpenAiKeyCandidate[];
  env?: OpenAiEnvReader | null;
  existingKeyOverride?: string | null;
  buildBody?: () => BodyInit;
  fetchImpl?: typeof fetch;
}): Promise<OpenAiFetchResult> {
  const candidates = params.candidates ??
    resolveOpenAiKeyCandidates({ env: params.env, existingKeyOverride: params.existingKeyOverride });
  if (candidates.length === 0) {
    throw new OpenAiKeyUnavailableError();
  }

  const doFetch = params.fetchImpl ?? fetch;
  const baseEvent = params.event ?? "openai_key_source";

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const headers = new Headers(params.init.headers as HeadersInit | undefined);
    headers.set("Authorization", `Bearer ${candidate.key}`);
    const body = params.buildBody ? params.buildBody() : params.init.body;

    const response = await doFetch(params.url, { ...params.init, headers, body });

    const hasNextCandidate = index + 1 < candidates.length;
    if (!hasNextCandidate || response.ok || !isOpenAiKeyFallbackStatus(response.status)) {
      logKeyEvent({
        logTag: params.logTag,
        event: baseEvent,
        source: candidate.source,
        status: response.status,
        fellBackFrom: index > 0 ? candidates[index - 1].source : undefined,
      });
      return { response, source: candidate.source };
    }

    // Eligible failure with another key available: record the transition, drain the
    // failed body so the connection is released, then retry with the next key.
    logKeyEvent({
      logTag: params.logTag,
      event: `${baseEvent}_fallback`,
      source: candidate.source,
      status: response.status,
    });
    try {
      await response.body?.cancel();
    } catch {
      /* ignore drain errors */
    }
  }

  // Unreachable: the final candidate always returns above.
  throw new OpenAiKeyUnavailableError();
}
