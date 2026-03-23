# Deal quality (MVP publish rules)

## Framework

| Tier | Meaning | Publish? | Future use |
|------|---------|----------|------------|
| **strong** | BOGO / 2-for-1 / b2g1 / half or second-item / **meaningful** free / dozen; **end of day** or **clearance** (EN+ES) with a **clear** value signal — including **EOD + single ≥40%** | Yes | **Notifications / top placement** — e.g. `quality_tier = 'strong'` |
| **acceptable** | **One** headline discount **≥ 40%** (numeric formats only), or **bundle / fixed-value** regex (`$` / U.S.-style pricing) | Yes | Normal feed; rank below **strong** |
| **weak** | **Competing headline %s** (see **multiple %** rule), **single % below 40**, vague copy, unclear bundles/free | **Blocked** | — |

Constants in `lib/deal-quality.ts`: `DEAL_QUALITY_MIN_PERCENT` (40), `DEAL_QUALITY_BLOCK_MESSAGE`, `DEAL_QUALITY_MULTIPLE_PERCENT_MESSAGE`, `DEAL_QUALITY_CLARIFY_VALUE_MESSAGE`.

---

## Product decisions (locked for MVP)

### Percent formats (numeric only)

- **Supported:** `40%`, `40 percent` / `40 percentage` (digits + English word).
- **Not supported:** Spelled-out numbers — e.g. “forty percent”, “cuarenta por ciento” — not parsed; businesses should use **`40%`** (or digit + `percent`) in copy.

### Currency (U.S.-first)

- **Supported:** **Dollar-style** patterns using **`$`** in regex (e.g. `$8 lunch`, `2 for $10`).
- **Not supported:** Other currencies or localized currency formats in MVP.

### Free add-ons / “gratis con compra”

- **Strict:** Bare **“gratis con compra”** (or vague English equivalents) **does not** auto-qualify.
- **Qualifying:** Only **named** meaningful items (see patterns in code: drink/side/dessert/second item, EN+ES).

### End-of-day + 40%+

- **Strong:** When copy is clearly **end of day** or **clearance** (EN+ES) **and** the contextual value includes **≥ 40% off** (single clear numeric headline %) **or** a structural/bundle signal, the deal is **`strong`** (same as other strong paths).

### Multiple percentages + primary offer

- **Default:** More than **one distinct** numeric % in the listing → **block** with **`DEAL_QUALITY_MULTIPLE_PERCENT_MESSAGE`** if the main offer is unclear.
- **Exception:** If a **structural** headline is present — **BOGO**, **2-for-1**, **buy-2-get-1**, **second-item half / 50%**, **meaningful free** lines, **dozen**-style, and the **Spanish equivalents** of those — then **extra %** in supporting/fine-print text **does not** trigger that block.
- **Not an exception:** Whole-deal **“half off”**, generic **“50% off”**, or **“mitad de precio”** alone — those can still sit next to another headline %; two competing headline discounts should still be simplified.

### Bundle phrasing

- **MVP:** Small EN+ES **keyword** list; unclear bundles → block + **`DEAL_QUALITY_CLARIFY_VALUE_MESSAGE`**.

### Spanish (bilingual MVP)

- **Qualifying phrases** in Spanish for **structural** deals, EOD, clearance, meaningful free items, bundle/fixed price (**`$`** or digit price after **por** where regex applies).
- **Percent detection** for rules is still **numeric only** (`%` or `N percent` with digits) — not Spanish spelled-out percents.

---

## Copy guidance for businesses (qualifying bundles)

Use **one** headline; make **items + savings** obvious:

- **English:** e.g. `2 for $10`, `Dinner for two for $35`, `$8 lunch — 2 slices + drink`, `BOGO bagels`, **`40%` off entrees**.
- **Spanish:** e.g. `2 por $10`, `Cena para dos por $35`, **`40%` de descuento** (use the **%** form), `2x1`, `Compra 2 y llévate 1 gratis`, `Bebida gratis con tu compra`.

If the main offer is **BOGO / 2-for-1 / buy-2-get-1**, avoid adding **other headline percentages** in the same listing when possible; if you must mention a small print %, keep the **structural** offer obvious in the **title** or first line.

---

## Intentionally unsupported in MVP

| Topic | MVP behavior |
|--------|----------------|
| Spelled-out % | Not parsed — use `40%` or `40 percent` |
| `N por ciento` (digits) | Not parsed — use `%` |
| Non-USD currency | Not supported in patterns |
| Bare “gratis con compra” | Does not qualify |
| NLP / semantic “primary” offer | Regex-only proxy via **structural** patterns |

---

## Business-facing messages

| Situation | Message constant |
|-----------|------------------|
| General bar / single % under 40 | `DEAL_QUALITY_BLOCK_MESSAGE` |
| Competing %s without clear structural primary | `DEAL_QUALITY_MULTIPLE_PERCENT_MESSAGE` |
| Vague or unclear bundle/free | `DEAL_QUALITY_CLARIFY_VALUE_MESSAGE` |
| Title too short | Short line + `DEAL_QUALITY_BLOCK_MESSAGE` |

---

## Enforcement

- **Client:** `assessDealQuality()` before `deals.insert` (Quick Deal + AI ad).
- **Server:** Not in Postgres yet — optional Edge Function later.

## Assumptions

- Heuristic **keyword/regex** lists; false positives possible (e.g. “not valid with BOGO” still matching **bogo**).
- **Legacy** rows may have `quality_tier` null until republished.
