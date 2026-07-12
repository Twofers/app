/**
 * Native wallet pass — APNs push for Apple Wallet updates (Deno/edge).
 * A pass update push is an EMPTY background notification whose topic is the
 * Pass Type identifier; the device then re-fetches the pass from the web
 * service. Authenticated by the Pass Type certificate via mTLS (proven: APNs
 * accepts the cert). No .p8 token key needed.
 */

export type ApnsResult = {
  ok: boolean;
  status: number;
  reason: string | null;
  /** True when APNs says the token is dead (410 / BadDeviceToken / Unregistered) → drop the registration. */
  shouldUnregister: boolean;
};

const APNS_HOST = "https://api.push.apple.com";

/**
 * Sends the empty update push. Reuses one Deno HTTP client (holds the mTLS
 * cert) across many tokens when the caller passes it in.
 */
export async function sendApnsUpdatePush(
  opts: { certPem: string; keyPem: string; passTypeId: string; deviceToken: string; httpClient?: unknown },
): Promise<ApnsResult> {
  // @ts-ignore Deno.createHttpClient client-cert options (unstable-http)
  const client = opts.httpClient ?? Deno.createHttpClient({ cert: opts.certPem, key: opts.keyPem });
  try {
    const res = await fetch(`${APNS_HOST}/3/device/${opts.deviceToken}`, {
      // @ts-ignore custom client for mTLS
      client,
      method: "POST",
      headers: {
        "apns-topic": opts.passTypeId,
        "apns-push-type": "background",
        "apns-priority": "5",
      },
      body: "{}",
    });
    let reason: string | null = null;
    if (!res.ok) {
      const text = await res.text();
      try {
        reason = text ? (JSON.parse(text).reason ?? null) : null;
      } catch {
        reason = null;
      }
    } else {
      await res.body?.cancel();
    }
    const shouldUnregister =
      res.status === 410 || reason === "BadDeviceToken" || reason === "Unregistered" || reason === "DeviceTokenNotForTopic";
    return { ok: res.ok, status: res.status, reason, shouldUnregister };
  } finally {
    // Close the client only when we created it here (not a shared one).
    if (!opts.httpClient) {
      try {
        // @ts-ignore
        client.close?.();
      } catch {
        // ignore
      }
    }
  }
}

/** Creates a reusable mTLS HTTP client for a batch of pushes. */
export function createApnsClient(certPem: string, keyPem: string): unknown {
  // @ts-ignore Deno.createHttpClient client-cert options
  return Deno.createHttpClient({ cert: certPem, key: keyPem });
}
