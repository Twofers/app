import type { LocalizedTermExpansionDictionary } from "./localized-offer-terms.ts";

// Item-name coverage that extends the reviewed base dictionary for CUSTOMER deal
// surfaces only (see localized-offer-terms.ts / buildLocalizedDealDisplay). It is
// consulted ONLY when the base has no entry for a given (term, locale), so it can
// never override a reviewed term and switch-off stays byte-identical to today.
//
// Rules for entries here:
// - Keys are the source term a merchant might type, lower-cased. Both the English
//   form ("americano") and a Korean/Spanish form ("아메리카노") are separate keys,
//   so a deal authored in either language localizes for every viewer.
// - Provide the translations a source item NEEDS: an English-authored item needs
//   es-US + ko-KR; a Korean/Spanish-authored item also needs en-US so English
//   viewers stop seeing the source script.
// - Korean koreanCounterId may ONLY be one of the three natively-reviewed
//   counters (korean-counter-registry.ts): "cup" (drinks/coffee/tea),
//   "piece" (pastry/discrete retail), "serving" (meals/plates). Anything else is
//   not reviewed and is left off — the renderer then uses its terse Korean form,
//   which is still correct, just less graceful. Never invent a counter.
// - Spanish is Mexican Spanish (DFW). Widely-used loanwords stay as loanwords
//   ("cold brew", "chai latte") the same way the base dictionary already does.
//
// No native Korean reviewer signs these off (Dan: "just do your best"). They are
// conservative: confident nouns only. The per-locale switch
// (EXPO_PUBLIC_DEAL_ITEM_TRANSLATION_LOCALES) is the safety valve if any read badly.

export const DEAL_ITEM_TRANSLATION_EXPANSION: LocalizedTermExpansionDictionary = {
  // ── Coffee & espresso drinks (English-authored) ──────────────────────────
  americano: { "es-US": { displayName: "americano" }, "ko-KR": { displayName: "아메리카노", koreanCounterId: "cup" } },
  "iced americano": { "es-US": { displayName: "americano helado" }, "ko-KR": { displayName: "아이스 아메리카노", koreanCounterId: "cup" } },
  cappuccino: { "es-US": { displayName: "capuchino" }, "ko-KR": { displayName: "카푸치노", koreanCounterId: "cup" } },
  macchiato: { "es-US": { displayName: "macchiato" }, "ko-KR": { displayName: "마키아토", koreanCounterId: "cup" } },
  "caramel macchiato": { "es-US": { displayName: "macchiato de caramelo" }, "ko-KR": { displayName: "카라멜 마키아토", koreanCounterId: "cup" } },
  mocha: { "es-US": { displayName: "moca" }, "ko-KR": { displayName: "모카", koreanCounterId: "cup" } },
  "cafe mocha": { "es-US": { displayName: "café moca" }, "ko-KR": { displayName: "카페 모카", koreanCounterId: "cup" } },
  "flat white": { "es-US": { displayName: "flat white" }, "ko-KR": { displayName: "플랫 화이트", koreanCounterId: "cup" } },
  cortado: { "es-US": { displayName: "cortado" }, "ko-KR": { displayName: "코르타도", koreanCounterId: "cup" } },
  affogato: { "es-US": { displayName: "affogato" }, "ko-KR": { displayName: "아포가토", koreanCounterId: "cup" } },
  "iced coffee": { "es-US": { displayName: "café helado" }, "ko-KR": { displayName: "아이스 커피", koreanCounterId: "cup" } },
  "nitro cold brew": { "es-US": { displayName: "nitro cold brew" }, "ko-KR": { displayName: "니트로 콜드브루", koreanCounterId: "cup" } },
  "vanilla latte": { "es-US": { displayName: "latte de vainilla" }, "ko-KR": { displayName: "바닐라 라떼", koreanCounterId: "cup" } },
  "caramel latte": { "es-US": { displayName: "latte de caramelo" }, "ko-KR": { displayName: "카라멜 라떼", koreanCounterId: "cup" } },
  "oat milk latte": { "es-US": { displayName: "latte de avena" }, "ko-KR": { displayName: "오트밀크 라떼", koreanCounterId: "cup" } },

  // ── Tea, matcha & other drinks ───────────────────────────────────────────
  // Matcha is 말차 in Korean; 마차 means "carriage". The base uses 말차 for
  // "matcha latte", so these stay consistent with it.
  "strawberry matcha": { "es-US": { displayName: "matcha de fresa" }, "ko-KR": { displayName: "딸기 말차", koreanCounterId: "cup" } },
  "matcha latte": { "es-US": { displayName: "latte de matcha" }, "ko-KR": { displayName: "말차 라떼", koreanCounterId: "cup" } },
  "iced matcha": { "es-US": { displayName: "matcha helado" }, "ko-KR": { displayName: "아이스 말차", koreanCounterId: "cup" } },
  "chai latte": { "es-US": { displayName: "chai latte" }, "ko-KR": { displayName: "차이 라떼", koreanCounterId: "cup" } },
  "hot chocolate": { "es-US": { displayName: "chocolate caliente" }, "ko-KR": { displayName: "핫초코", koreanCounterId: "cup" } },
  "hot tea": { "es-US": { displayName: "té caliente" }, "ko-KR": { displayName: "따뜻한 차", koreanCounterId: "cup" } },
  "green tea": { "es-US": { displayName: "té verde" }, "ko-KR": { displayName: "녹차", koreanCounterId: "cup" } },
  "black tea": { "es-US": { displayName: "té negro" }, "ko-KR": { displayName: "홍차", koreanCounterId: "cup" } },
  "herbal tea": { "es-US": { displayName: "té de hierbas" }, "ko-KR": { displayName: "허브차", koreanCounterId: "cup" } },
  lemonade: { "es-US": { displayName: "limonada" }, "ko-KR": { displayName: "레모네이드", koreanCounterId: "cup" } },
  smoothie: { "es-US": { displayName: "smoothie" }, "ko-KR": { displayName: "스무디", koreanCounterId: "cup" } },
  frappe: { "es-US": { displayName: "frappé" }, "ko-KR": { displayName: "프라페", koreanCounterId: "cup" } },
  "orange juice": { "es-US": { displayName: "jugo de naranja" }, "ko-KR": { displayName: "오렌지 주스", koreanCounterId: "cup" } },
  "apple juice": { "es-US": { displayName: "jugo de manzana" }, "ko-KR": { displayName: "사과 주스", koreanCounterId: "cup" } },
  "bottled water": { "es-US": { displayName: "agua embotellada" }, "ko-KR": { displayName: "생수" } },
  "sparkling water": { "es-US": { displayName: "agua con gas" }, "ko-KR": { displayName: "탄산수" } },

  // ── Bakery & pastry (English-authored) ───────────────────────────────────
  muffin: { "es-US": { displayName: "muffin" }, "ko-KR": { displayName: "머핀", koreanCounterId: "piece" } },
  "blueberry muffin": { "es-US": { displayName: "muffin de arándanos" }, "ko-KR": { displayName: "블루베리 머핀", koreanCounterId: "piece" } },
  "banana bread": { "es-US": { displayName: "pan de plátano" }, "ko-KR": { displayName: "바나나 브레드", koreanCounterId: "piece" } },
  "cinnamon roll": { "es-US": { displayName: "rollo de canela" }, "ko-KR": { displayName: "시나몬 롤", koreanCounterId: "piece" } },
  donut: { "es-US": { displayName: "dona" }, "ko-KR": { displayName: "도넛", koreanCounterId: "piece" } },
  scone: { "es-US": { displayName: "scone" }, "ko-KR": { displayName: "스콘", koreanCounterId: "piece" } },
  brownie: { "es-US": { displayName: "brownie" }, "ko-KR": { displayName: "브라우니", koreanCounterId: "piece" } },
  cheesecake: { "es-US": { displayName: "cheesecake" }, "ko-KR": { displayName: "치즈케이크", koreanCounterId: "piece" } },
  macaron: { "es-US": { displayName: "macaron" }, "ko-KR": { displayName: "마카롱", koreanCounterId: "piece" } },
  pretzel: { "es-US": { displayName: "pretzel" }, "ko-KR": { displayName: "프레첼", koreanCounterId: "piece" } },
  "danish pastry": { "es-US": { displayName: "pan danés" }, "ko-KR": { displayName: "데니시", koreanCounterId: "piece" } },
  "chocolate croissant": { "es-US": { displayName: "croissant de chocolate" }, "ko-KR": { displayName: "초코 크루아상", koreanCounterId: "piece" } },
  "slice of cake": { "es-US": { displayName: "rebanada de pastel" }, "ko-KR": { displayName: "케이크 한 조각", koreanCounterId: "piece" } },
  cupcake: { "es-US": { displayName: "cupcake" }, "ko-KR": { displayName: "컵케이크", koreanCounterId: "piece" } },

  // ── Food (English-authored) ──────────────────────────────────────────────
  "avocado toast": { "es-US": { displayName: "pan tostado con aguacate" }, "ko-KR": { displayName: "아보카도 토스트", koreanCounterId: "piece" } },
  "breakfast sandwich": { "es-US": { displayName: "sándwich de desayuno" }, "ko-KR": { displayName: "브렉퍼스트 샌드위치", koreanCounterId: "piece" } },
  "grilled cheese": { "es-US": { displayName: "sándwich de queso a la plancha" }, "ko-KR": { displayName: "그릴드 치즈 샌드위치", koreanCounterId: "piece" } },
  "ham and cheese sandwich": { "es-US": { displayName: "sándwich de jamón y queso" }, "ko-KR": { displayName: "햄 치즈 샌드위치", koreanCounterId: "piece" } },
  "turkey sandwich": { "es-US": { displayName: "sándwich de pavo" }, "ko-KR": { displayName: "터키 샌드위치", koreanCounterId: "piece" } },
  "club sandwich": { "es-US": { displayName: "sándwich club" }, "ko-KR": { displayName: "클럽 샌드위치", koreanCounterId: "piece" } },
  panini: { "es-US": { displayName: "panini" }, "ko-KR": { displayName: "파니니", koreanCounterId: "piece" } },
  wrap: { "es-US": { displayName: "wrap" }, "ko-KR": { displayName: "랩", koreanCounterId: "piece" } },
  "caesar salad": { "es-US": { displayName: "ensalada César" }, "ko-KR": { displayName: "시저 샐러드", koreanCounterId: "serving" } },
  "house salad": { "es-US": { displayName: "ensalada de la casa" }, "ko-KR": { displayName: "하우스 샐러드", koreanCounterId: "serving" } },
  "soup of the day": { "es-US": { displayName: "sopa del día" }, "ko-KR": { displayName: "오늘의 수프", koreanCounterId: "serving" } },
  quiche: { "es-US": { displayName: "quiche" }, "ko-KR": { displayName: "키슈", koreanCounterId: "piece" } },
  bagel: { "ko-KR": { displayName: "베이글", koreanCounterId: "piece" }, "es-US": { displayName: "bagel" } },

  // ── Reverse: Korean-authored café staples (source in Hangul) ─────────────
  // English viewers stop seeing Hangul; Korean viewers get the counter sentence.
  "아메리카노": { "en-US": { displayName: "americano" }, "es-US": { displayName: "americano" }, "ko-KR": { displayName: "아메리카노", koreanCounterId: "cup" } },
  "아이스 아메리카노": { "en-US": { displayName: "iced americano" }, "es-US": { displayName: "americano helado" }, "ko-KR": { displayName: "아이스 아메리카노", koreanCounterId: "cup" } },
  "카페라떼": { "en-US": { displayName: "cafe latte" }, "es-US": { displayName: "latte" }, "ko-KR": { displayName: "카페라떼", koreanCounterId: "cup" } },
  "카페 라떼": { "en-US": { displayName: "cafe latte" }, "es-US": { displayName: "latte" }, "ko-KR": { displayName: "카페 라떼", koreanCounterId: "cup" } },
  "라떼": { "en-US": { displayName: "latte" }, "es-US": { displayName: "latte" }, "ko-KR": { displayName: "라떼", koreanCounterId: "cup" } },
  "카푸치노": { "en-US": { displayName: "cappuccino" }, "es-US": { displayName: "capuchino" }, "ko-KR": { displayName: "카푸치노", koreanCounterId: "cup" } },
  "바닐라 라떼": { "en-US": { displayName: "vanilla latte" }, "es-US": { displayName: "latte de vainilla" }, "ko-KR": { displayName: "바닐라 라떼", koreanCounterId: "cup" } },
  "녹차 라떼": { "en-US": { displayName: "green tea latte" }, "es-US": { displayName: "latte de té verde" }, "ko-KR": { displayName: "녹차 라떼", koreanCounterId: "cup" } },
  "고구마 라떼": { "en-US": { displayName: "sweet potato latte" }, "es-US": { displayName: "latte de camote" }, "ko-KR": { displayName: "고구마 라떼", koreanCounterId: "cup" } },
  "밀크티": { "en-US": { displayName: "milk tea" }, "es-US": { displayName: "té con leche" }, "ko-KR": { displayName: "밀크티", koreanCounterId: "cup" } },
  "버블티": { "en-US": { displayName: "bubble tea" }, "es-US": { displayName: "té con perlas" }, "ko-KR": { displayName: "버블티", koreanCounterId: "cup" } },

  // ── Reverse: Spanish-authored staples (source in Spanish) ────────────────
  "cafe de olla": { "en-US": { displayName: "spiced coffee" }, "ko-KR": { displayName: "카페 데 오야", koreanCounterId: "cup" }, "es-US": { displayName: "café de olla" } },
  "concha": { "en-US": { displayName: "concha (sweet bread)" }, "ko-KR": { displayName: "콘차", koreanCounterId: "piece" }, "es-US": { displayName: "concha" } },
  "cafe con leche": { "en-US": { displayName: "coffee with milk" }, "ko-KR": { displayName: "카페 콘 레체", koreanCounterId: "cup" }, "es-US": { displayName: "café con leche" } },
  "horchata": { "en-US": { displayName: "horchata" }, "ko-KR": { displayName: "오르차타", koreanCounterId: "cup" }, "es-US": { displayName: "horchata" } },
  "pan dulce": { "en-US": { displayName: "sweet bread" }, "ko-KR": { displayName: "판 둘세", koreanCounterId: "piece" }, "es-US": { displayName: "pan dulce" } },
  "empanada": { "en-US": { displayName: "empanada" }, "ko-KR": { displayName: "엠파나다", koreanCounterId: "piece" }, "es-US": { displayName: "empanada" } },
};
