/**
 * Shared OpenAI image generation helpers.
 *
 * Used by:
 * - ai-compose-offer: single poster with baked-in text (legacy illustration style).
 * - ai-generate-ad-variants: photographic single ad — no baked-in text; the app UI renders
 *   the headline above the image.
 */

export const IMAGE_MODEL = Deno.env.get("OPENAI_IMAGE_MODEL")?.trim() || "dall-e-3";
export const IMAGE_EDIT_MODEL = Deno.env.get("OPENAI_IMAGE_EDIT_MODEL")?.trim() || "gpt-image-1";

// ---------------------------------------------------------------------------
// LEGACY: Generic poster prompt (used by ai-compose-offer)
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
// V2: Photographic ad image — no text baked in, the app renders copy above the image
// Used by the new single-ad flow when no cafe photo is available
// ---------------------------------------------------------------------------

export function buildPhotoAdImagePrompt(params: {
  itemName: string;
  itemDescription?: string;
  businessName?: string;
}): string {
  const { itemName, itemDescription, businessName } = params;
  const esc = (s: string) => s.replace(/"/g, "'").trim();
  return [
    `Professional product photography of ${esc(itemName)}.`,
    itemDescription ? `Description: ${esc(itemDescription)}.` : "",
    businessName ? `For an independent cafe called ${esc(businessName)}.` : "",
    "Photographic style — natural daylight, soft shadow, shallow depth of field, slightly off-center composition.",
    "Single hero subject. Clean cafe surface (light wood, marble, or matte ceramic) as background.",
    "Honest, appetizing, editorial — like a Bon Appetit photo, not a stock image, not an illustration, not a marketing render.",
    "Absolutely no text, no logos, no labels, no signage, no banners, no overlays, no QR codes anywhere in the image.",
    "No human faces, no hands holding the item.",
    "Square 1:1 framing.",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 3800);
}

// ---------------------------------------------------------------------------
// V2: DALL-E 3 generation tuned for photographic output
// ---------------------------------------------------------------------------

export async function generatePhotoAdImage(
  openAiKey: string,
  prompt: string,
  logTag = "ai_ads_v2",
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
      payload.quality = "hd";
      payload.style = "natural";
    }
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
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
    return await decodeImageResponse(res, logTag);
  } catch (e) {
    console.log(JSON.stringify({ tag: logTag, event: "image_gen_error", err: String(e) }));
    return null;
  }
}

// ---------------------------------------------------------------------------
// V2: Photo enhancement — three levels via gpt-image-1 edit endpoint
// ---------------------------------------------------------------------------

export type PhotoTreatment = "touchup" | "cleanbg" | "studiopolish";

const TREATMENT_PROMPTS: Record<PhotoTreatment, string> = {
  touchup:
    "Enhance lighting, correct white balance, lift shadows, sharpen detail, and remove minor noise. " +
    "Do not change the subject, the composition, the background, or the colors of the food itself. " +
    "Output a natural, slightly polished version of this exact photo.",
  cleanbg:
    "Replace the background with a clean, neutral cafe surface (warm light wood or soft matte gray). " +
    "Keep the subject — the food or drink — exactly as it appears, including its colors, shape, and angle. " +
    "Soft natural daylight, gentle shadow under the subject. No text, no logos, no people, no other objects.",
  studiopolish:
    "Re-light this photograph as professional product photography. " +
    "Soft directional daylight from the upper left, gentle shadow under the subject, shallow depth of field background blur. " +
    "Keep the subject — the food or drink — recognizably the same item with the same proportions, garnish, and color. " +
    "Background: clean cafe surface (light wood, marble, or matte ceramic). " +
    "Editorial Bon Appetit style. Absolutely no text, logos, watermarks, or people in the image.",
};

/**
 * Enhance an uploaded cafe photo using OpenAI's image-edit endpoint (gpt-image-1).
 * Returns the enhanced PNG bytes, or null if the edit failed (caller falls back to original).
 */
export async function enhanceUploadedPhoto(params: {
  openAiKey: string;
  imageBytes: Uint8Array;
  imageMime: string;
  treatment: PhotoTreatment;
  logTag?: string;
}): Promise<Uint8Array | null> {
  const { openAiKey, imageBytes, imageMime, treatment, logTag = "ai_ads_v2_enhance" } = params;
  try {
    const form = new FormData();
    form.append("model", IMAGE_EDIT_MODEL);
    form.append("prompt", TREATMENT_PROMPTS[treatment]);
    form.append("size", "1024x1024");
    form.append("quality", "medium");
    const blob = new Blob([imageBytes], { type: imageMime || "image/png" });
    form.append("image", blob, imageMime === "image/jpeg" ? "input.jpg" : "input.png");

    const res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${openAiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.log(
        JSON.stringify({
          tag: logTag,
          event: "enhance_http",
          treatment,
          status: res.status,
          body: errBody.slice(0, 800),
        }),
      );
      return null;
    }
    return await decodeImageResponse(res, logTag);
  } catch (e) {
    console.log(
      JSON.stringify({ tag: logTag, event: "enhance_error", treatment, err: String(e) }),
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// LEGACY: original generator used by old 3-variant flow + ai-compose-offer
// Kept for backward compat — vivid + standard quality + illustration-leaning.
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
      signal: AbortSignal.timeout(60_000),
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
    return await decodeImageResponse(res, logTag);
  } catch (e) {
    console.log(JSON.stringify({ tag: logTag, event: "image_gen_error", err: String(e) }));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal: decode b64_json (or fall back to URL fetch) from an OpenAI response
// ---------------------------------------------------------------------------

async function decodeImageResponse(
  res: Response,
  logTag: string,
): Promise<Uint8Array | null> {
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
    JSON.stringify({ tag: logTag, event: "image_gen_no_data" }),
  );
  return null;
}
