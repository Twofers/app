/**
 * Shared DALL-E image generation helpers.
 * Used by ai-compose-offer (single poster) and ai-generate-ad-variants (3 lane images).
 */

export const IMAGE_MODEL = Deno.env.get("OPENAI_IMAGE_MODEL")?.trim() || "dall-e-3";

// ---------------------------------------------------------------------------
// Generic poster prompt (used by ai-compose-offer)
// ---------------------------------------------------------------------------

export function buildPosterImagePrompt(params: {
  businessName: string;
  displayOffer: string;
  headline: string;
  sub: string;
  visualDirection: string;
}): string {
  const { businessName, displayOffer, headline, sub, visualDirection } = params;
  const esc = (s: string) => s.replace(/"/g, "'");
  return [
    "Square promotional graphic for a local café deal mobile app (TWOFER).",
    "Clean, modern, appetizing — illustration or stylized food art. No photorealistic human faces.",
    `Venue: ${esc(businessName)}.`,
    `Offer: ${esc(displayOffer)}.`,
    `Large readable headline on image: "${esc(headline || displayOffer)}".`,
    sub.trim() ? `Smaller subline: "${esc(sub)}".` : "",
    visualDirection.trim() ? `Mood: ${esc(visualDirection)}` : "",
    "Accent color bright orange #FF9F1C; light background. English text only. No QR codes.",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 3800);
}

// ---------------------------------------------------------------------------
// Lane-specific ad variant prompt (used by ai-generate-ad-variants)
// ---------------------------------------------------------------------------

type CreativeLane = "value" | "neighborhood" | "premium";

const LANE_STYLE_DIRECTION: Record<CreativeLane, string> = {
  value:
    "Bold, eye-catching savings graphic. Warm orange and yellow tones. " +
    "Prominent offer/price text overlay. High contrast, energetic, inviting. " +
    "Think: bright food illustration with a big deal callout banner.",
  neighborhood:
    "Warm, cozy local café scene. Golden hour light, earthy greens and browns. " +
    "Community feeling — a welcoming storefront or table setting. " +
    "Think: neighborhood gem you'd walk to on a Sunday morning.",
  premium:
    "Elegant, refined product showcase. Clean composition with rich darks and soft light. " +
    "Sophisticated craft quality — close-up of artisan food or drink. " +
    "Think: specialty coffee roaster or boutique bakery branding.",
};

export function buildAdVariantImagePrompt(params: {
  lane: CreativeLane;
  businessName: string;
  headline: string;
  subheadline: string;
  visualDirection: string;
}): string {
  const { lane, businessName, headline, subheadline, visualDirection } = params;
  const esc = (s: string) => s.replace(/"/g, "'");
  const laneDir = LANE_STYLE_DIRECTION[lane] ?? LANE_STYLE_DIRECTION.value;
  return [
    "Square promotional ad graphic for TWOFER, a local BOGO deals app.",
    "Stylized illustration or food art — NOT a photograph. No photorealistic human faces. No QR codes.",
    `Style direction: ${laneDir}`,
    visualDirection.trim() ? `Additional mood: ${esc(visualDirection)}` : "",
    `Business: ${esc(businessName)}.`,
    `Large readable headline on image: "${esc(headline)}".`,
    subheadline.trim() ? `Smaller subline: "${esc(subheadline)}".` : "",
    "Include small TWOFER branding mark in a corner.",
    "Accent color bright orange #FF9F1C. Text must be legible. English text only.",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 3800);
}

// ---------------------------------------------------------------------------
// DALL-E image generation
// ---------------------------------------------------------------------------

export async function tryGeneratePosterPng(
  openAiKey: string,
  prompt: string,
  logTag = "ai_image",
): Promise<Uint8Array | null> {
  try {
    const payload: Record<string, unknown> = {
      model: IMAGE_MODEL,
      prompt,
      n: 1,
      size: "1024x1024",
      response_format: "b64_json",
    };
    if (IMAGE_MODEL.includes("dall-e-3")) {
      payload.quality = "standard";
      payload.style = "vivid";
    }
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.log(
        JSON.stringify({
          tag: logTag,
          event: "image_gen_http",
          status: res.status,
          body: errBody.slice(0, 800),
        }),
      );
      return null;
    }
    const j = await res.json();
    const row = j?.data?.[0] as Record<string, unknown> | undefined;
    const b64 = row?.b64_json;
    if (typeof b64 === "string" && b64.length > 0) {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    const imageUrl = typeof row?.url === "string" ? row.url : null;
    if (imageUrl) {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) {
        console.log(
          JSON.stringify({
            tag: logTag,
            event: "image_gen_url_fetch",
            status: imgRes.status,
          }),
        );
        return null;
      }
      const buf = new Uint8Array(await imgRes.arrayBuffer());
      return buf.length > 0 ? buf : null;
    }
    console.log(
      JSON.stringify({ tag: logTag, event: "image_gen_no_data", model: IMAGE_MODEL }),
    );
    return null;
  } catch (e) {
    console.log(JSON.stringify({ tag: logTag, event: "image_gen_error", err: String(e) }));
    return null;
  }
}
