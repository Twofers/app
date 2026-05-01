# Pilot Onboarding Script

A one-page walkthrough for the first 10 founding cafes. Run this in person or over a 25-minute Zoom. Print or open on a laptop next to the owner's phone.

**Goal:** owner has a working business profile, a saved menu, one published deal, and knows how to redeem a claim — before you leave the room.

**Time:** 20–25 minutes per cafe.

**What to bring:**
- Your phone (Android, with the TWOFER internal-testing build installed)
- Their phone (Android preferred for the pilot)
- A clear photo of their menu board, ready to take if they don't already have one
- This script (printed or on screen)

---

## Before the meeting (5 min)

1. **Confirm Stripe is configured.** Open `docs/stripe-setup.md` Step 7 — sign in as a test user, tap Subscribe with `4242 4242 4242 4242`, confirm `subscription_status` flips to `active`. If this doesn't work, **postpone the cafe meeting** — billing must be solid before you onboard real owners.
2. **Send the cafe a 1-line text:**
   > "Excited to set you up on TWOFER today. Bring your phone (Android works best) and your menu — we'll have you running in 20 minutes."
3. **Bump their `trial_ends_at` to 60 days** in advance:
   ```sql
   update business_profiles
   set trial_ends_at = now() + interval '60 days'
   where user_id = (select id from auth.users where email = 'cafe-owner@example.com');
   ```

---

## In the meeting

### 1. Sign up (3 min)

> "Open the Play Store internal-testing link I sent. Tap **Install**, then **Create account**. Pick **Business**, enter your email and a password you'll remember."

- Check: app lands on the **Business setup** screen, not the consumer feed.
- If they hit a verification email screen, have them check Gmail and click the link before continuing.

### 2. Business profile (5 min)

> "Type your business name. Tap **Look up** — TWOFER will fill in your address, phone, hours, and category automatically. Just check it and edit anything that's wrong."

- The AI lookup uses Google + an LLM. ~80% of independent cafes hit on the first try.
- If lookup misses or fields are wrong: have them type address, phone, and hours manually. Pick the closest **Category** (Coffee shop, Bakery, Cafe).
- **Required fields**: name, address, city/state/zip, phone, hours, category.
- **Optional but worth doing:** logo or storefront photo (improves trust on the consumer feed).

### 3. Menu scan (5 min) — THE WOW MOMENT

> "Tap **Create** in the bottom bar, then **Scan Your Menu** — the orange-bordered card. Take a photo of your menu board, or pick one from your library."

- Wait 8–15 seconds while AI extracts items.
- **Show them the result:** "These are the items TWOFER pulled from your menu. Review the names and prices — fix anything that's wrong, then tap **Save**."
- If extraction is poor (handwritten, glare, partial menu): take a second photo, or have them edit/add manually. **Worst case, type 5 staple items by hand** — this still saves time on every future deal.
- **Why this matters:** "Now every deal you create reuses these items. You won't type them again."

### 4. First deal (5 min)

> "Tap **Create → New Deal**. Use the voice button to describe your offer. Try: *'Buy one oat milk latte, get one free, Tuesday afternoons 2 to 5'*."

- AI generates 3 ad variants: **Value**, **Neighborhood**, **Premium**. They pick one.
- They tap **Schedule** and confirm date/time. Defaults work for one-off deals.
- They tap **Publish**. The deal is live.
- **Show them the consumer feed on YOUR phone** (logged in as a separate consumer test account). Their deal appears with a countdown.

### 5. Redeem walkthrough (3 min)

> "Now I'll claim your deal as a customer. When I show up at your counter, you'll do this:"

- On your consumer phone: tap the deal → **Claim** → wallet shows the claim with a QR code.
- On their business phone: tap **Redeem** tab → **Scan QR**. Scan your phone. Deal flips to **Redeemed**.
- **Or the visual fallback:** "If your camera is acting up, your customer can slide-to-confirm on their wallet. You see a 15-second pass on their phone — that's the receipt."

### 6. Dashboard tour (2 min)

> "This is your dashboard. You'll see live deals, scheduled deals, claims, and redemptions. The **Insights** panel shows things like time-of-day patterns and new vs. returning customers — but only after you've had a few claims."

- Don't dwell. Most owners just want to know the numbers exist.

### 7. Wrap-up (2 min)

Hand them a printed mini-card (or text it to them):

> **TWOFER for [Cafe Name]**
> - **Trial ends:** [date 60 days from today]
> - **Your support contact:** twoferadmin@gmail.com
> - **First-week goal:** post 1 deal per slow window. Watch what works.
> - **Need help?** Text Dan: [phone]

---

## Common stumbles + fixes

| Stumble | Fix |
|---|---|
| **"I don't see my deal in the customer app"** | Check radius default (10 mi). On your test consumer account, set radius to 25 mi if cafe is in a far suburb. |
| **"AI lookup got my address wrong"** | Manual entry is fine. Save and continue. Don't waste 5 min on lookup tuning. |
| **"Menu scan returned weird items"** | Probably handwritten or glare. Take a second photo of the printed/typed menu inside, or fall back to manual entry of 5 staples. |
| **"How do I cancel a deal?"** | Dashboard → tap the deal → **End deal**. Active claims stay valid until they expire. |
| **"What about iOS customers?"** | "iOS launches in week 2. For now, customers on iPhone can sign up via the website (link to come) and we'll text them when iOS is live." |
| **"What happens after my trial?"** | "$30/mo for unlimited deals. We'll text you a week before. No surprise charges." |

---

## What NOT to promise on day one

- **Recurring deals** — built but not battle-tested. Have them post one-shot deals for the first two weeks. Recurring goes on after we see a pattern owner-by-owner.
- **Multi-location billing** — Premium tier is hidden in the pilot. If they ask about a second location, write it down and follow up; don't try to enable it.
- **Push notifications** — they'll work for consumers who opt in, but don't oversell volume. The first week's feed will be sparse.
- **Korean / Spanish UI** — fully built, but skip mentioning to English-speaking owners. Don't use as a selling point unless they ask.

---

## After the meeting (10 min, async)

1. **Slack / text Dan** with: cafe name, owner email, what deal they posted, anything broken.
2. **Watch the dashboard** for 24–48 hours. If they have zero claims by day 3, send a personal text: "Want to brainstorm a deal that'll move? Happy to jump on a 5-min call."
3. **Drop one personal redeem** in the first 48 hours — a friend, a family member, you. Owner sees activity early. Keeps them engaged.
4. **Add their suburb to your "covered radius" map.** When you onboard cafe #6, you'll start to see which suburbs need more coverage.

---

## The 10-cafe goal

- **By end of week 1:** all 10 onboarded, each has posted at least one deal.
- **By end of week 2:** at least 5 cafes have had 5+ claims, at least 3 have had 1+ redemption.
- **By end of week 4:** 2 cafes asking about recurring deals = signal recurring is ready to ship to all.
- **By end of week 8 (trial 60-day end):** at least 6 of 10 willing to enter a card. That's a 60% paid conversion — a strong pilot result.

If you're below those numbers, the issue is almost never the app. It's onboarding pace and personal follow-through. Spend more time on those, not on building features.
