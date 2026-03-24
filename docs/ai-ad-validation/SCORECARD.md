# Manual scorecard — AI ad MVP (12 cases)

**Scoring (1–5 each row per generation):** 1 = fail, 3 = acceptable, 5 = excellent.

| Dimension | What to judge |
|-----------|----------------|
| **Offer accuracy** | Item(s), discount type, **price** (if any), **time window** match owner note + schedule. No invented “today” unless note says it. |
| **Lane differentiation** | Can you name which card is **value**, **neighborhood**, **premium** without reading labels? ≥2 cards clearly different? |
| **Local / business fit** | Sounds like a real neighborhood spot; not Groupon / corporate; profile (if set) helps **tone** without changing facts. |
| **Usefulness w/ light edits** | Publishable with small tweaks, not full rewrite. |
| **Overall quality** | Would you ship this to a real owner? |

**Differentiation pass rule:** If you cannot tell **value vs local vs quality** intent, cap **Lane differentiation** at **2**.

**Offer fail rule:** Any wrong item, price, discount, or schedule → **Offer accuracy ≤ 2** and note why in comments.

---

## Per-case must-verify (checklist)

Use with [TEST_CASE_INPUTS.md](./TEST_CASE_INPUTS.md).

### TC01 — Coffee latte BOGO
- [ ] BOGO / two-for-one lattes clear  
- [ ] **2 PM – 4 PM** (or equivalent) reflected when schedule set  
- [ ] “Today” only if note says today  

### TC02 — Bakery muffins
- [ ] Half off + **muffins**  
- [ ] **After 2 PM**  

### TC03 — Pizza lunch
- [ ] Two slices + drink  
- [ ] **$8**  
- [ ] **11 AM – 2 PM**  

### TC04 — Smoothie BOGO
- [ ] Smoothie BOGO  
- [ ] **3 PM – 5 PM**  

### TC05 — Donut dozen
- [ ] Mixed dozen / box deal  
- [ ] **$10**  
- [ ] **After 5 PM**  

### TC06 — Sandwich combo
- [ ] Free drink + **full sandwich**  
- [ ] **1 PM – 3 PM**  

### TC07 — Ice cream
- [ ] Second scoop **half off**  
- [ ] **2 PM – 4 PM**  

### TC08 — Tacos
- [ ] Buy 2 get 1 free + **tacos**  
- [ ] **2 PM – 5 PM**  

### TC09 — Boba
- [ ] Free topping + **large drink**  
- [ ] **12 PM – 3 PM**  

### TC10 — Deli salads
- [ ] **25% off** prepared salads  
- [ ] **After 4 PM**  

### TC11 — Juice bar
- [ ] Second half off + **juice**  
- [ ] **1 PM – 3 PM**  

### TC12 — Bagel
- [ ] Free coffee + **bagel sandwich**  
- [ ] **After 10 AM**  

---

## Session metadata (top of each run)

- Date:  
- Tester:  
- App build / branch:  
- Model (`OPENAI_AD_MODEL` if not default):  
- **Manual QA tag:** TC__  
- Account profile: empty / filled (describe):  
- Regeneration attempt: 0 / 1 / 2  

Then score the **three returned ads** (optional: score best card only + note which lane).
