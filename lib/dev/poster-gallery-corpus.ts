// AUTO-GENERATED [aiqa] poster-quality run 2026-07-20 — dev-only gallery corpus.
// Real ad.poster specs + background storage paths from the first-run responses
// (artifacts/ai-hardening/2026-07-20/tier1/i0*/response.json), plus measured top/bottom
// band luminance (band-luma.json) to drive the renderer's luminance-aware scrim.
// Removable tooling; not shipped logic. See docs/plans/poster-ad-quality-harness.md.
export type PosterGalleryCell = {
  id: string;
  label: string;
  spec: unknown;
  luma: { top: number; bottom: number } | null;
  kicker: string | null;
  offerLine: string | null;
  sourcePath: string | null;
  photoSource: string | null;
};
export const POSTER_GALLERY_CORPUS: PosterGalleryCell[] = [
  {
    "id": "i01",
    "label": "BOGO latte (native 4:5)",
    "spec": {
      "version": 1,
      "enabled": true,
      "template_id": "fresh",
      "aspect_ratio": "4:5",
      "source_asset_path": "04d699d3-618b-4707-a6bd-afc23f486f5a/ai_ad_gemini_1784592147517_3a9b5b6c.png",
      "rendered_asset_path": null,
      "copy": {
        "business_name": "The Colonel's Brew",
        "headline": "MISSION: TWO LATTES",
        "offer_line_1": "2 FOR 1",
        "offer_line_2": "LATTE",
        "subline": "MISSION READY"
      },
      "copy_by_language": {
        "en-US": {
          "business_name": "The Colonel's Brew",
          "headline": "MISSION: TWO LATTES",
          "offer_line_1": "2 FOR 1",
          "offer_line_2": "LATTE"
        },
        "es-US": {
          "business_name": "The Colonel's Brew",
          "headline": "LATTE",
          "offer_line_1": "2 POR 1",
          "offer_line_2": "LATTE"
        },
        "ko-KR": {
          "business_name": "The Colonel's Brew",
          "headline": "라떼",
          "offer_line_1": "추가 1 무료",
          "offer_line_2": "라떼"
        }
      },
      "layout_policy": {
        "text_align": "center",
        "safe_area_percent": 8,
        "max_lines": {
          "business_name": 1,
          "headline": 2,
          "offer_line_1": 1,
          "offer_line_2": 1,
          "subline": 1
        }
      },
      "content_policy": {
        "no_app_brand_token": true,
        "no_cta": true,
        "no_scarcity": true,
        "no_mutable_live_facts": true,
        "image_text_free": true
      },
      "policy": {
        "passed": true,
        "reasonCodes": [],
        "removedTerms": [],
        "warnings": []
      },
      "composition_plan": "Create a realistic, professional local business advertising image for a mobile deal app. Business context for styling only, never render as text: The Colonel's Brew Business type for styling only: Coffee shop Offer mechanics: Buy one latte, get one latte free. Ad context: The image will be used inside a mobile local-deal card. Required visible items: latte. Selected AI ad concept for composition only, never render as text: Military-themed coffee shop styling with two latte cups and a strong, simple poster layout, no text in image. Create the product-focused visual from the offer facts only. Image requirements: - Show the actual paid item and free item clearly if they are visually distinct. - Make the food or drink look real, appetizing, and professionally photographed. - Use natural lighting and a local business marketing style. - Avoid the glossy, fake, over-rendered AI look. - Keep every required item fully inside the center-safe area and away from crop edges. - Leave clean visual space near the top or bottom for the app to overlay the exact offer text later. - Keep the top and bottom overlay zones calm enough for native text contrast. - Use vertical 4:5 poster-ready framing with the product centered and calm native-text overlay space. - The generated image must be text-free: no words, letters, numbers, discount copy, business names, app names, menu boards, signs, labels, stickers, or watermarks. - Do not add readable text. - Do not add coupons. - Do not add QR codes. - Do not add prices. - Do not add fake logos. - Do not add fake business names. - Do not add app mascots, characters, animals, penguins, or unrelated decorative props unless they are the actual product being sold or visible in the owner reference photo. - Do not add distorted hands, extra fingers, warped cups, impossible packaging, or strange food shapes. - Do not misrepresent the offer. Style: realistic local cafe advertisement, natural light, clean counter or table, approachable, appetizing, not overly polished. Avoid: AI-looking plastic food, readable or unreadable fake text, misspelled signs, extra cups, incorrect item counts, app mascots, unrelated characters, distorted hands, fake QR codes, fake logos, fake brand marks, random menu boards, uncanny people, strange reflections, watermark-like marks, unrealistic packaging, and any text inside the generated image. The final headline, business name, CTA, quantity, expiration, and offer terms will be rendered by the app outside this image. Do not render those words inside the image."
    },
    "luma": {
      "top": 0.755,
      "bottom": 0.52
    },
    "kicker": "Mission ready",
    "offerLine": "Buy one latte and get one free",
    "sourcePath": "04d699d3-618b-4707-a6bd-afc23f486f5a/ai_ad_gemini_1784592147517_3a9b5b6c.png",
    "photoSource": "generated"
  },
  {
    "id": "i02",
    "label": "BOGO Sergeant Stripes — F4 fix (square fallback)",
    "spec": {
      "version": 1,
      "enabled": true,
      "template_id": "fresh",
      "aspect_ratio": "4:5",
      "source_asset_path": "04d699d3-618b-4707-a6bd-afc23f486f5a/ai_ad_generated_1784592017290_57cff007.png",
      "rendered_asset_path": null,
      "copy": {
        "business_name": "The Colonel's Brew",
        "headline": "TWO ROUNDS OF STRIPES",
        "offer_line_1": "2 FOR 1",
        "offer_line_2": "THE SERGEANT'S STRIPES",
        "subline": "COFFEE PAIR"
      },
      "copy_by_language": {
        "en-US": {
          "business_name": "The Colonel's Brew",
          "headline": "TWO ROUNDS OF STRIPES",
          "offer_line_1": "2 FOR 1",
          "offer_line_2": "THE SERGEANT'S STRIPES"
        },
        "es-US": {
          "business_name": "The Colonel's Brew",
          "headline": "THE SERGEANT'S STRIPES",
          "offer_line_1": "2 POR 1",
          "offer_line_2": "THE SERGEANT'S STRIPES"
        },
        "ko-KR": {
          "business_name": "The Colonel's Brew",
          "headline": "THE SERGEANT'S STRIPES",
          "offer_line_1": "추가 1 무료",
          "offer_line_2": "THE SERGEANT'S STRIPES"
        }
      },
      "layout_policy": {
        "text_align": "center",
        "safe_area_percent": 8,
        "max_lines": {
          "business_name": 1,
          "headline": 2,
          "offer_line_1": 1,
          "offer_line_2": 1,
          "subline": 1
        }
      },
      "content_policy": {
        "no_app_brand_token": true,
        "no_cta": true,
        "no_scarcity": true,
        "no_mutable_live_facts": true,
        "image_text_free": true
      },
      "policy": {
        "passed": true,
        "reasonCodes": [],
        "removedTerms": [],
        "warnings": []
      },
      "composition_plan": "Editorial food photography — photoreal THE SERGEANT'S STRIPES (Select origins estate grown coffee) as the single hero subject. Description: A freshly brewed coffee made from select estate-grown beans sourced from various origins, offering a unique and high-quality flavor profile.. For an independent cafe called The Colonel's Brew. Selected ad concept for composition only, never render as text: Close-up of two servings of THE SERGEANT'S STRIPES in a warm coffee shop setting, leaving room for poster copy.. Natural soft daylight, realistic textures and cast shadows, true-to-life proportions, high fine detail, clean composition, shallow depth of field. Cafe surface backdrop — light wood, marble, or matte ceramic — uncluttered. Honest, appetizing, magazine-quality — not stocky, not illustrated, not a CGI render. Keep every required item fully inside the center-safe area and away from crop edges. Leave clean visual space near the top or bottom for native offer text overlays; keep those zones calm enough for contrast. Absolutely no text, letters, numbers, prices, coupons, discount copy, menu boards, signage, banners, overlays, QR codes, barcodes, logos, fake logos, brand marks, watermarks, mascots, cartoon characters, animals, or unrelated prop characters. No human faces, no hands holding the item. Vertical 4:5 poster-ready framing with the product centered and calm native-text overlay space."
    },
    "luma": {
      "top": 0.082,
      "bottom": 0.146
    },
    "kicker": "Coffee pair",
    "offerLine": "Buy one SERGEANT'S STRIPES (Select origins estate grown coffee) and get one free",
    "sourcePath": "04d699d3-618b-4707-a6bd-afc23f486f5a/ai_ad_generated_1784592017290_57cff007.png",
    "photoSource": "generated"
  },
  {
    "id": "i04",
    "label": "40%-off single latte (native 4:5, best)",
    "spec": {
      "version": 1,
      "enabled": true,
      "template_id": "fresh",
      "aspect_ratio": "4:5",
      "source_asset_path": "04d699d3-618b-4707-a6bd-afc23f486f5a/ai_ad_gemini_1784587637712_70371f80.png",
      "rendered_asset_path": null,
      "copy": {
        "business_name": "The Colonel's Brew",
        "headline": "LATTE SAVINGS",
        "offer_line_1": "40% OFF",
        "offer_line_2": "LATTE",
        "subline": "LATTE DEAL"
      },
      "copy_by_language": {
        "en-US": {
          "business_name": "The Colonel's Brew",
          "headline": "LATTE SAVINGS",
          "offer_line_1": "40% OFF",
          "offer_line_2": "LATTE"
        },
        "es-US": {
          "business_name": "The Colonel's Brew",
          "headline": "LATTE",
          "offer_line_1": "40% DE DESCUENTO",
          "offer_line_2": "LATTE"
        },
        "ko-KR": {
          "business_name": "The Colonel's Brew",
          "headline": "라떼",
          "offer_line_1": "40% 할인",
          "offer_line_2": "라떼"
        }
      },
      "layout_policy": {
        "text_align": "center",
        "safe_area_percent": 8,
        "max_lines": {
          "business_name": 1,
          "headline": 2,
          "offer_line_1": 1,
          "offer_line_2": 1,
          "subline": 1
        }
      },
      "content_policy": {
        "no_app_brand_token": true,
        "no_cta": true,
        "no_scarcity": true,
        "no_mutable_live_facts": true,
        "image_text_free": true
      },
      "policy": {
        "passed": true,
        "reasonCodes": [],
        "removedTerms": [],
        "warnings": []
      },
      "composition_plan": "Create a realistic, professional local business advertising image for a mobile deal app. Business context for styling only, never render as text: The Colonel's Brew Business type for styling only: Coffee shop Offer mechanics: Get 40% off one latte. Redeem only at The Colonel's Brew. Limited quantity available. Ad context: The image will be used inside a mobile local-deal card. Required visible items: latte. Selected AI ad concept for composition only, never render as text: Single latte in a cafe cup on a clean counter with calm poster space around it. Create the product-focused visual from the offer facts only. Image requirements: - Show the actual paid item and free item clearly if they are visually distinct. - Make the food or drink look real, appetizing, and professionally photographed. - Use natural lighting and a local business marketing style. - Avoid the glossy, fake, over-rendered AI look. - Keep every required item fully inside the center-safe area and away from crop edges. - Leave clean visual space near the top or bottom for the app to overlay the exact offer text later. - Keep the top and bottom overlay zones calm enough for native text contrast. - Use vertical 4:5 poster-ready framing with the product centered and calm native-text overlay space. - The generated image must be text-free: no words, letters, numbers, discount copy, business names, app names, menu boards, signs, labels, stickers, or watermarks. - Do not add readable text. - Do not add coupons. - Do not add QR codes. - Do not add prices. - Do not add fake logos. - Do not add fake business names. - Do not add app mascots, characters, animals, penguins, or unrelated decorative props unless they are the actual product being sold or visible in the owner reference photo. - Do not add distorted hands, extra fingers, warped cups, impossible packaging, or strange food shapes. - Do not misrepresent the offer. Style: realistic local cafe advertisement, natural light, clean counter or table, approachable, appetizing, not overly polished. Avoid: AI-looking plastic food, readable or unreadable fake text, misspelled signs, extra cups, incorrect item counts, app mascots, unrelated characters, distorted hands, fake QR codes, fake logos, fake brand marks, random menu boards, uncanny people, strange reflections, watermark-like marks, unrealistic packaging, and any text inside the generated image. The final headline, business name, CTA, quantity, expiration, and offer terms will be rendered by the app outside this image. Do not render those words inside the image."
    },
    "luma": {
      "top": 0.387,
      "bottom": 0.188
    },
    "kicker": "Latte deal",
    "offerLine": "Get 40% off one latte",
    "sourcePath": "04d699d3-618b-4707-a6bd-afc23f486f5a/ai_ad_gemini_1784587637712_70371f80.png",
    "photoSource": "generated"
  },
  {
    "id": "i05",
    "label": "Buy latte get cappuccino (native 4:5)",
    "spec": {
      "version": 1,
      "enabled": true,
      "template_id": "fresh",
      "aspect_ratio": "4:5",
      "source_asset_path": "04d699d3-618b-4707-a6bd-afc23f486f5a/ai_ad_gemini_1784587730200_ed783189.png",
      "rendered_asset_path": null,
      "copy": {
        "business_name": "The Colonel's Brew",
        "headline": "A LOCAL COFFEE STOP PERK",
        "offer_line_1": "FREE CAPPUCCINO",
        "offer_line_2": "WITH LATTE",
        "subline": "LOCAL STOP"
      },
      "copy_by_language": {
        "en-US": {
          "business_name": "The Colonel's Brew",
          "headline": "A LOCAL COFFEE STOP PERK",
          "offer_line_1": "FREE CAPPUCCINO",
          "offer_line_2": "WITH LATTE"
        },
        "es-US": {
          "business_name": "The Colonel's Brew",
          "headline": "AL COMPRAR 1 LATTE",
          "offer_line_1": "CAPUCHINO GRATIS",
          "offer_line_2": "AL COMPRAR 1 LATTE"
        },
        "ko-KR": {
          "business_name": "The Colonel's Brew",
          "headline": "라떼 X 1 구매 시",
          "offer_line_1": "카푸치노 무료",
          "offer_line_2": "라떼 X 1 구매 시"
        }
      },
      "layout_policy": {
        "text_align": "center",
        "safe_area_percent": 8,
        "max_lines": {
          "business_name": 1,
          "headline": 2,
          "offer_line_1": 1,
          "offer_line_2": 1,
          "subline": 1
        }
      },
      "content_policy": {
        "no_app_brand_token": true,
        "no_cta": true,
        "no_scarcity": true,
        "no_mutable_live_facts": true,
        "image_text_free": true
      },
      "policy": {
        "passed": true,
        "reasonCodes": [],
        "removedTerms": [],
        "warnings": []
      },
      "composition_plan": "Regenerate the ad image. The previous image missed: readable text, blurry background menu board with text-like markings. The new image must clearly show all required offer items as main subjects: latte, cappuccino. Make every required item clearly visible and equally important. Remove all readable text, letters, numbers, app names, business names, logos, prices, coupons, menu boards, QR codes, watermark-like marks, mascots, cartoon characters, animals, app mascots, and unrelated character props. Create a realistic, professional local business advertising image for a mobile deal app. Business context for styling only, never render as text: The Colonel's Brew Business type for styling only: Coffee shop Offer mechanics: Buy latte, get cappuccino free. Ad context: The image will be used inside a mobile local-deal card. Required visible items: latte, cappuccino. Selected AI ad concept for composition only, never render as text: Warm coffee shop scene with two espresso drinks on the counter and clean space for poster copy. Create the product-focused visual from the offer facts only. Image requirements: - Show the actual paid item and free item clearly if they are visually distinct. - Make the food or drink look real, appetizing, and professionally photographed. - Use natural lighting and a local business marketing style. - Avoid the glossy, fake, over-rendered AI look. - Keep every required item fully inside the center-safe area and away from crop edges. - Leave clean visual space near the top or bottom for the app to overlay the exact offer text later. - Keep the top and bottom overlay zones calm enough for native text contrast. - Use vertical 4:5 poster-ready framing with the product centered and calm native-text overlay space. - The generated image must be text-free: no words, letters, numbers, discount copy, business names, app names, menu boards, signs, labels, stickers, or watermarks. - Do not add readable text. - Do not add coupons. - Do not add QR codes. - Do not add prices. - Do not add fake logos. - Do not add fake business names. - Do not add app mascots, characters, animals, penguins, or unrelated decorative props unless they are the actual product being sold or visible in the owner reference photo. - Do not add distorted hands, extra fingers, warped cups, impossible packaging, or strange food shapes. - Do not misrepresent the offer. Style: realistic local cafe advertisement, natural light, clean counter or table, approachable, appetizing, not overly polished. Avoid: AI-looking plastic food, readable or unreadable fake text, misspelled signs, extra cups, incorrect item counts, app mascots, unrelated characters, distorted hands, fake QR codes, fake logos, fake brand marks, random menu boards, uncanny people, strange reflections, watermark-like marks, unrealistic packaging, and any text inside the generated image. The final headline, business name, CTA, quantity, expiration, and offer terms will be rendered by the app outside this image. Do not render those words inside the image."
    },
    "luma": {
      "top": 0.538,
      "bottom": 0.583
    },
    "kicker": "Local stop",
    "offerLine": "Buy a latte and get a free cappuccino",
    "sourcePath": "04d699d3-618b-4707-a6bd-afc23f486f5a/ai_ad_gemini_1784587730200_ed783189.png",
    "photoSource": "generated"
  }
];
