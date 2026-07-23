import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchOpenAiWithFallback,
  hasConfiguredOpenAiKey,
  isOpenAiKeyFallbackStatus,
  OpenAiKeyUnavailableError,
  resolveOpenAiKeyCandidates,
} from "./openai-fetch.ts";

function env(values: Record<string, string | undefined>) {
  return { get: (name: string) => values[name] };
}

const BOTH_KEYS = env({ OPENAI_API_KEY_PREPAID: "sk-prepaid", OPENAI_API_KEY: "sk-existing" });

type FetchCall = { url: string; authorization: string | null; body: BodyInit | null | undefined };

/**
 * A fake `fetch` that records the URL + Authorization header of each attempt and
 * returns the queued responses in order. A queued `Error` is thrown instead.
 */
function makeFetch(queued: Array<Response | Error>) {
  const calls: FetchCall[] = [];
  let index = 0;
  const impl = (async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers as HeadersInit | undefined);
    calls.push({ url, authorization: headers.get("Authorization"), body: init.body });
    const next = queued[index++] ?? new Response("{}", { status: 200 });
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isOpenAiKeyFallbackStatus", () => {
  it("is eligible only for 401/403/404/429", () => {
    for (const status of [401, 403, 404, 429]) {
      expect(isOpenAiKeyFallbackStatus(status)).toBe(true);
    }
    for (const status of [200, 201, 400, 402, 422, 500, 502, 503]) {
      expect(isOpenAiKeyFallbackStatus(status)).toBe(false);
    }
  });
});

describe("resolveOpenAiKeyCandidates", () => {
  it("orders the prepaid key before the existing key", () => {
    expect(resolveOpenAiKeyCandidates({ env: BOTH_KEYS })).toEqual([
      { source: "openai_prepaid", key: "sk-prepaid" },
      { source: "openai_existing_fallback", key: "sk-existing" },
    ]);
  });

  it("collapses to a single prepaid candidate when both keys are identical", () => {
    const candidates = resolveOpenAiKeyCandidates({
      env: env({ OPENAI_API_KEY_PREPAID: "same", OPENAI_API_KEY: "same" }),
    });
    expect(candidates).toEqual([{ source: "openai_prepaid", key: "same" }]);
  });

  it("trims whitespace and ignores empty values", () => {
    const candidates = resolveOpenAiKeyCandidates({
      env: env({ OPENAI_API_KEY_PREPAID: "   ", OPENAI_API_KEY: "  sk-existing  " }),
    });
    expect(candidates).toEqual([{ source: "openai_existing_fallback", key: "sk-existing" }]);
  });

  it("uses existingKeyOverride for the existing slot while reading prepaid from env", () => {
    const candidates = resolveOpenAiKeyCandidates({
      env: env({ OPENAI_API_KEY_PREPAID: "sk-prepaid", OPENAI_API_KEY: "env-existing" }),
      existingKeyOverride: "injected-existing",
    });
    expect(candidates).toEqual([
      { source: "openai_prepaid", key: "sk-prepaid" },
      { source: "openai_existing_fallback", key: "injected-existing" },
    ]);
  });

  it("reports configuration presence", () => {
    expect(hasConfiguredOpenAiKey({ env: BOTH_KEYS })).toBe(true);
    expect(hasConfiguredOpenAiKey({ env: env({}) })).toBe(false);
  });
});

describe("fetchOpenAiWithFallback", () => {
  it("attempts the prepaid key first and returns its source", async () => {
    const { impl, calls } = makeFetch([new Response("{}", { status: 200 })]);
    const { response, source } = await fetchOpenAiWithFallback({
      url: "https://api.openai.com/v1/chat/completions",
      init: { method: "POST", body: "{}" },
      logTag: "test",
      env: BOTH_KEYS,
      fetchImpl: impl,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].authorization).toBe("Bearer sk-prepaid");
    expect(source).toBe("openai_prepaid");
    expect(response.status).toBe(200);
    // The returned result must not carry key material.
    expect(JSON.stringify({ source, status: response.status })).not.toContain("sk-prepaid");
  });

  for (const status of [401, 403, 404, 429]) {
    it(`falls back to the existing key only after an eligible HTTP ${status}`, async () => {
      const { impl, calls } = makeFetch([
        new Response(JSON.stringify({ error: { message: "denied" } }), { status }),
        new Response("{}", { status: 200 }),
      ]);
      const { response, source } = await fetchOpenAiWithFallback({
        url: "https://api.openai.com/v1/x",
        init: { method: "POST", body: "{}" },
        logTag: "test",
        env: BOTH_KEYS,
        fetchImpl: impl,
      });

      expect(calls.map((call) => call.authorization)).toEqual([
        "Bearer sk-prepaid",
        "Bearer sk-existing",
      ]);
      expect(source).toBe("openai_existing_fallback");
      expect(response.status).toBe(200);
    });
  }

  it("does NOT retry on HTTP 400 (malformed request / validation)", async () => {
    const { impl, calls } = makeFetch([
      new Response(JSON.stringify({ error: { type: "invalid_request_error" } }), { status: 400 }),
      new Response("{}", { status: 200 }), // must never be reached
    ]);
    const { response, source } = await fetchOpenAiWithFallback({
      url: "https://api.openai.com/v1/x",
      init: { method: "POST", body: "{}" },
      logTag: "test",
      env: BOTH_KEYS,
      fetchImpl: impl,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].authorization).toBe("Bearer sk-prepaid");
    expect(response.status).toBe(400);
    expect(source).toBe("openai_prepaid");
  });

  it("does NOT key-fall-back on a 5xx server error", async () => {
    const { impl, calls } = makeFetch([
      new Response("upstream", { status: 500 }),
      new Response("{}", { status: 200 }),
    ]);
    const { response, source } = await fetchOpenAiWithFallback({
      url: "https://api.openai.com/v1/x",
      init: { method: "POST", body: "{}" },
      logTag: "test",
      env: BOTH_KEYS,
      fetchImpl: impl,
    });

    expect(calls).toHaveLength(1);
    expect(response.status).toBe(500);
    expect(source).toBe("openai_prepaid");
  });

  it("propagates a thrown fetch error without trying the existing key", async () => {
    const { impl, calls } = makeFetch([
      new Error("network down"),
      new Response("{}", { status: 200 }),
    ]);
    await expect(
      fetchOpenAiWithFallback({
        url: "https://api.openai.com/v1/x",
        init: { method: "POST", body: "{}" },
        logTag: "test",
        env: BOTH_KEYS,
        fetchImpl: impl,
      }),
    ).rejects.toThrow("network down");
    expect(calls).toHaveLength(1);
    expect(calls[0].authorization).toBe("Bearer sk-prepaid");
  });

  it("uses the existing key as the sole source when prepaid is unset", async () => {
    const { impl, calls } = makeFetch([new Response("{}", { status: 200 })]);
    const { source } = await fetchOpenAiWithFallback({
      url: "https://api.openai.com/v1/x",
      init: { method: "POST", body: "{}" },
      logTag: "test",
      env: env({ OPENAI_API_KEY: "sk-existing" }),
      fetchImpl: impl,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].authorization).toBe("Bearer sk-existing");
    expect(source).toBe("openai_existing_fallback");
  });

  it("uses the prepaid key as the sole source when the existing key is unset", async () => {
    const { impl, calls } = makeFetch([new Response("{}", { status: 200 })]);
    const { source } = await fetchOpenAiWithFallback({
      url: "https://api.openai.com/v1/x",
      init: { method: "POST", body: "{}" },
      logTag: "test",
      env: env({ OPENAI_API_KEY_PREPAID: "sk-prepaid" }),
      fetchImpl: impl,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].authorization).toBe("Bearer sk-prepaid");
    expect(source).toBe("openai_prepaid");
  });

  it("does not retry when the sole configured key hits an eligible status", async () => {
    const { impl, calls } = makeFetch([new Response("{}", { status: 429 })]);
    const { response, source } = await fetchOpenAiWithFallback({
      url: "https://api.openai.com/v1/x",
      init: { method: "POST", body: "{}" },
      logTag: "test",
      env: env({ OPENAI_API_KEY: "sk-existing" }),
      fetchImpl: impl,
    });
    expect(calls).toHaveLength(1);
    expect(response.status).toBe(429);
    expect(source).toBe("openai_existing_fallback");
  });

  it("throws OpenAiKeyUnavailableError when no key is configured", async () => {
    const { impl, calls } = makeFetch([]);
    await expect(
      fetchOpenAiWithFallback({
        url: "https://api.openai.com/v1/x",
        init: { method: "POST", body: "{}" },
        logTag: "test",
        env: env({}),
        fetchImpl: impl,
      }),
    ).rejects.toBeInstanceOf(OpenAiKeyUnavailableError);
    expect(calls).toHaveLength(0);
  });

  it("rebuilds a single-use body for each key attempt", async () => {
    let builds = 0;
    const { impl, calls } = makeFetch([
      new Response("{}", { status: 401 }),
      new Response("{}", { status: 200 }),
    ]);
    await fetchOpenAiWithFallback({
      url: "https://api.openai.com/v1/x",
      init: { method: "POST" },
      buildBody: () => {
        builds += 1;
        return new Blob([`body-${builds}`]);
      },
      logTag: "test",
      env: BOTH_KEYS,
      fetchImpl: impl,
    });
    expect(builds).toBe(2);
    expect(calls).toHaveLength(2);
    expect(calls[0].body).not.toBe(calls[1].body);
  });

  it("logs only the source label and status — never key material", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { impl } = makeFetch([
      new Response("{}", { status: 401 }),
      new Response("{}", { status: 200 }),
    ]);
    await fetchOpenAiWithFallback({
      url: "https://api.openai.com/v1/x",
      init: { method: "POST", body: "{}" },
      logTag: "test",
      env: BOTH_KEYS,
      fetchImpl: impl,
    });
    const logged = logSpy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("sk-prepaid");
    expect(logged).not.toContain("sk-existing");
    expect(logged).not.toContain("Bearer");
    expect(logged).toContain("openai_prepaid");
    expect(logged).toContain("openai_existing_fallback");
  });
});
