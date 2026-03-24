/**
 * Deterministic 3-lane ad variants for the demo account (no OpenAI).
 * Response shape matches real ai-generate-ad-variants output.
 */

export type CreativeLane = "value" | "neighborhood" | "premium";

export type AdVariant = {
  creative_lane: CreativeLane;
  headline: string;
  subheadline: string;
  cta: string;
  style_label: string;
  rationale: string;
  visual_direction: string;
};

export const DEMO_ACCOUNT_EMAIL = "demo@demo.com";

export function isDemoUserEmail(email: string | undefined | null): boolean {
  return (email ?? "").trim().toLowerCase() === DEMO_ACCOUNT_EMAIL;
}

type BusinessContext = {
  category?: string;
  tone?: string;
  location?: string;
  description?: string;
};

export type DemoVariantParams = {
  hint_text: string;
  price: unknown;
  business_name: string;
  business_context: BusinessContext;
  offer_schedule_summary: string;
  output_language: "en" | "es" | "ko";
  regeneration_attempt: number;
};

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

function priceLabel(price: unknown): string | null {
  if (price == null || price === "") return null;
  const n = Number(price);
  if (!Number.isFinite(n)) return String(price).trim().slice(0, 14);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
    .format(n);
}

function offerSnippet(hint: string, max: number): string {
  return clip(hint, max);
}

function scheduleFragment(summary: string, lang: "en" | "es" | "ko"): string {
  const s = summary.trim();
  if (!s) return "";
  if (lang === "es") return clip(`Horario: ${s}`, 72);
  if (lang === "ko") return clip(`일정: ${s}`, 72);
  return clip(`Schedule: ${s}`, 72);
}

/** Returns ads in lane order: value, neighborhood, premium. */
export function buildDemoAdVariants(p: DemoVariantParams): AdVariant[] {
  const hint = p.hint_text.trim();
  const offer = offerSnippet(hint, 52);
  const offerMid = offerSnippet(hint, 70);
  const biz = clip(p.business_name.trim() || "Your place", 28);
  const loc = (p.business_context.location ?? "").trim();
  const category = (p.business_context.category ?? "").trim();
  const locBit = loc ? clip(loc, 22) : "";
  const catBit = category ? clip(category, 24) : "";
  const sched = scheduleFragment(p.offer_schedule_summary, p.output_language);
  const price = priceLabel(p.price);
  const rot = p.regeneration_attempt % 3;

  const en = (): AdVariant[] => {
    const vHead = price
      ? rot === 0
        ? clip(`${price} · ${offer}`, 40)
        : rot === 1
        ? clip(`Straight savings on ${offer}`, 40)
        : clip(`More for less — ${offer}`, 40)
      : rot === 0
      ? clip(`Real value on ${offer}`, 40)
      : rot === 1
      ? clip(`Built for regulars: ${offer}`, 40)
      : clip(`Fair price, full flavor`, 40);

    const vSub = [
      clip(`${offerMid}${sched ? ` · ${sched}` : ""}`, 88),
      clip(`Clear offer, no guesswork — ${offerMid}`, 88),
      clip(`Honest wording around what's included: ${offerMid}`, 88),
    ][rot]!;

    const nHead = locBit
      ? rot === 0
        ? clip(`${biz} near ${locBit}`, 40)
        : rot === 1
        ? clip(`Your corner spot — ${offer}`, 40)
        : clip(`Locals know this one`, 40)
      : rot === 0
      ? clip(`${biz} — neighbor favorite`, 40)
      : rot === 1
      ? clip(`Same crew, same welcome`, 40)
      : clip(`For people who live nearby`, 40);

    const nSub = [
      clip(
        locBit
          ? `Proud to be part of the ${locBit} block. ${offerMid}`
          : `Warm, familiar, and built for repeat visits. ${offerMid}`,
        88,
      ),
      clip(`We keep it local and personal. ${offerMid}`, 88),
      clip(`Think “see you again soon,” not corporate. ${offerMid}`, 88),
    ][rot]!;

    const pHead = catBit
      ? rot === 0
        ? clip(`Crafted ${catBit} experience`, 40)
        : rot === 1
        ? clip(`Quality you can taste`, 40)
        : clip(`Made with care, not volume`, 40)
      : rot === 0
      ? clip(`Small details, big difference`, 40)
      : rot === 1
      ? clip(`Ingredients and care, front and center`, 40)
      : clip(`Elevated without being stiff`, 40);

    const pSub = [
      clip(`Focus on what makes this offer worth trying — ${offerMid}`, 88),
      clip(`Premium feel that still matches your real offer: ${offerMid}`, 88),
      clip(`Polished tone, grounded in what you actually serve. ${offerMid}`, 88),
    ][rot]!;

    return [
      {
        creative_lane: "value",
        headline: vHead,
        subheadline: vSub,
        cta: clip(["Claim in the app", "Redeem today", "Lock it in"][rot]!, 26),
        style_label: ["Clear savings", "No-nonsense deal", "Budget-smart"][rot]!,
        rationale: "Leads with the concrete benefit so busy shoppers get the point fast.",
        visual_direction: "Bold price or offer line, simple background, high contrast.",
      },
      {
        creative_lane: "neighborhood",
        headline: nHead,
        subheadline: nSub,
        cta: clip(["Stop by soon", "See you there", "We're close by"][rot]!, 26),
        style_label: ["Local regulars", "Corner spot", "Community tone"][rot]!,
        rationale: "Feels like a place people recognize and return to, not a chain blast.",
        visual_direction: "Warm light, candid vibe, subtle map or street context if available.",
      },
      {
        creative_lane: "premium",
        headline: pHead,
        subheadline: pSub,
        cta: clip(["Taste the difference", "Reserve your spot", "Try it once"][rot]!, 26),
        style_label: ["Quality-led", "Craft focus", "Refined simplicity"][rot]!,
        rationale: "Highlights care and quality without overpromising beyond the owner note.",
        visual_direction: "Clean layout, tighter crop on product, restrained typography.",
      },
    ];
  };

  const es = (): AdVariant[] => {
    const vHead = price
      ? clip(`${price} · ${offer}`, 40)
      : clip(`Buen precio en ${offer}`, 40);
    const vSub = clip(`${offerMid}${sched ? ` · ${sched}` : ""}`, 88);
    const nHead = locBit ? clip(`${biz} cerca de ${locBit}`, 40) : clip(`${biz} — de la zona`, 40);
    const nSub = clip(
      locBit
        ? `Orgullosos de servir en ${locBit}. ${offerMid}`
        : `Trato cercano y de confianza. ${offerMid}`,
      88,
    );
    const pHead = catBit ? clip(`Calidad ${catBit}`, 40) : clip(`Hecho con mimo`, 40);
    const pSub = clip(`Destacamos el cuidado detrás de la oferta: ${offerMid}`, 88);
    const ctaV = ["Canjear en la app", "Aprovechar ahora", "Reservar oferta"][rot]!;
    const ctaN = ["Pásate pronto", "Te esperamos", "Cerca de ti"][rot]!;
    const ctaP = ["Pruébalo hoy", "Siente la calidad", "Una visita vale"][rot]!;
    return [
      {
        creative_lane: "value",
        headline: rot === 1 ? clip(`Ahorro claro: ${offer}`, 40) : rot === 2 ? clip(`Más por menos`, 40) : vHead,
        subheadline: rot === 1 ? clip(`Sin letra pequeña inventada — ${offerMid}`, 88) : rot === 2
        ? clip(`Oferta directa al grano: ${offerMid}`, 88)
        : vSub,
        cta: clip(ctaV, 26),
        style_label: ["Ahorro claro", "Oferta directa", "Precio justo"][rot]!,
        rationale: "Enfatiza el beneficio tangible para quien va con prisa.",
        visual_direction: "Precio u oferta legible, fondo simple.",
      },
      {
        creative_lane: "neighborhood",
        headline: rot === 1 ? clip(`Tu sitio de siempre`, 40) : rot === 2 ? clip(`Vecinos de confianza`, 40) : nHead,
        subheadline: rot === 1 ? clip(`Ambiente cercano y familiar. ${offerMid}`, 88) : rot === 2
        ? clip(`Hecho para la gente del barrio. ${offerMid}`, 88)
        : nSub,
        cta: clip(ctaN, 26),
        style_label: ["Barrio", "Cercanía", "Confianza local"][rot]!,
        rationale: "Suena a negocio de la zona, no a anuncio genérico.",
        visual_direction: "Luz cálida, ambiente local auténtico.",
      },
      {
        creative_lane: "premium",
        headline: rot === 1 ? clip(`Calidad que se nota`, 40) : rot === 2 ? clip(`Cuidado en cada detalle`, 40) : pHead,
        subheadline: rot === 1 ? clip(`Buen producto sin prometer de más: ${offerMid}`, 88) : rot === 2
        ? clip(`Equilibrio entre fino y honesto. ${offerMid}`, 88)
        : pSub,
        cta: clip(ctaP, 26),
        style_label: ["Calidad", "Oficio", "Detalle"][rot]!,
        rationale: "Refuerza calidad sin inventar beneficios fuera de la nota del dueño.",
        visual_direction: "Encuadre limpio y producto protagonista.",
      },
    ];
  };

  const ko = (): AdVariant[] => {
    const vHead = price ? clip(`${price} · ${offer}`, 40) : clip(`부담 없이 ${offer}`, 40);
    const vSub = clip(`${offerMid}${sched ? ` · ${sched}` : ""}`, 88);
    const nHead = locBit ? clip(`${biz} · ${locBit} 근처`, 40) : clip(`${biz} · 동네 단골`, 40);
    const nSub = clip(locBit ? `${locBit} 동네와 함께합니다. ${offerMid}` : `익숙한 맛과 편안한 분위기. ${offerMid}`, 88);
    const pHead = catBit ? clip(`${catBit} 퀄리티`, 40) : clip(`정성 담긴 한 끼`, 40);
    const pSub = clip(`과장 없이 본질만 담았습니다: ${offerMid}`, 88);
    return [
      {
        creative_lane: "value",
        headline: rot === 1 ? clip(`가성비 ${offer}`, 40) : rot === 2 ? clip(`부담 없는 혜택`, 40) : vHead,
        subheadline: rot === 1 ? clip(`조건을 숨기지 않고: ${offerMid}`, 88) : rot === 2
        ? clip(`핵심만 전합니다 — ${offerMid}`, 88)
        : vSub,
        cta: clip(["앱에서 받기", "지금 신청", "혜택 확인"][rot]!, 26),
        style_label: ["가성비", "명확한 혜택", "합리적"][rot]!,
        rationale: "바쁜 사용자에게 혜택을 빠르게 전달합니다.",
        visual_direction: "가격·혜택 강조, 배경은 단순하게.",
      },
      {
        creative_lane: "neighborhood",
        headline: rot === 1 ? clip(`단골이 찾는 곳`, 40) : rot === 2 ? clip(`동네 맛집 느낌`, 40) : nHead,
        subheadline: rot === 1 ? clip(`따뜻한 동네 분위기. ${offerMid}`, 88) : rot === 2
        ? clip(`가까운 곳에서 만나요. ${offerMid}`, 88)
        : nSub,
        cta: clip(["곧 방문해요", "기다릴게요", "가까이 있어요"][rot]!, 26),
        style_label: ["동네", "친근함", "단골"][rot]!,
        rationale: "지역과 친근함을 살려 체인 광고 느낌을 줄입니다.",
        visual_direction: "따뜻한 조명, 일상적인 장면.",
      },
      {
        creative_lane: "premium",
        headline: rot === 1 ? clip(`품질로 승부`, 40) : rot === 2 ? clip(`정성 있는 한 접시`, 40) : pHead,
        subheadline: rot === 1 ? clip(`과장 없이 품질만: ${offerMid}`, 88) : rot === 2
        ? clip(`세련되되 솔직하게 — ${offerMid}`, 88)
        : pSub,
        cta: clip(["한번 맛보기", "지금 예약", "직접 확인"][rot]!, 26),
        style_label: ["프리미엄", "정성", "디테일"][rot]!,
        rationale: "품질을 강조하되 사장님 메모를 벗어나지 않습니다.",
        visual_direction: "깔끔한 구도, 제품 클로즈업.",
      },
    ];
  };

  const builders = { en, es, ko };
  return builders[p.output_language]();
}
