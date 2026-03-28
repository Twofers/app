const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH_SIZE = 100;

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  channelId?: string;
};

export type ExpoPushResult = {
  sent: number;
  errors: number;
};

/**
 * Send Expo push notifications in batches of 100 (Expo API limit).
 * Best-effort: logs failures but never throws.
 */
export async function sendExpoPushBatch(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<ExpoPushResult> {
  if (tokens.length === 0) return { sent: 0, errors: 0 };

  const unique = [...new Set(tokens)];
  const messages: ExpoPushMessage[] = unique.map((token) => ({
    to: token,
    title,
    body,
    data,
    sound: "default" as const,
    channelId: "deal-alerts",
  }));

  let sent = 0;
  let errors = 0;

  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        console.error(`[expo-push] HTTP ${res.status}: ${await res.text()}`);
        errors += batch.length;
        continue;
      }
      const json = await res.json();
      const tickets = json?.data ?? [];
      for (const ticket of tickets) {
        if (ticket.status === "ok") {
          sent++;
        } else {
          errors++;
          if (ticket.details?.error) {
            console.warn(`[expo-push] Ticket error: ${ticket.details.error}`);
          }
        }
      }
    } catch (err) {
      console.error("[expo-push] Batch send failed:", err);
      errors += batch.length;
    }
  }

  return { sent, errors };
}

/** Earth radius in km. */
const R_KM = 6371;

/** Haversine distance in miles between two WGS84 points. */
export function haversineMiles(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return (R_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) / 1.60934;
}
