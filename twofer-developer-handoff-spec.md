# Twofer Developer Handoff Specification
Before any work: read docs/twofer-developer-handoff-spec.md. This is the single source of truth. Sections 1 through 5 are binding: locked decisions, current state, identifiers, open questions, and work rules. Stop on any [CONFIRM] item and surface it for human decision.

Do not refactor, tidy, add features, or introduce abstractions beyond the task. A bug fix does not need surrounding cleanup and a one-shot operation does not need a helper. Trust existing code and frameworks. Do the smallest thing that works well.

Model: Fable 5. Effort: high for audits and auth. Medium for fix batches. Xhigh reserved for one or two hard problems if high stalls. Work in plan mode during read-only phases.

This is the single source of truth for finishing Twofer and debugging it on both Android and iOS. The first pass of work will be done by an AI coding agent, so this document is written to be precise. Every fact that is current and verified is stated plainly. Every fact that still needs human confirmation is marked **[CONFIRM]**. The agent must not treat a [CONFIRM] item as settled, and must stop and ask before acting on one.

If anything in this document conflicts with the actual code, the code wins. Report the conflict rather than silently following the doc.

---

## 0. How to use this document

- Read sections 1 through 5 first. They are the contract: locked decisions, current state, identifiers, open questions, and the work rules.
- Sections 6 through 29 are the full product spec, organized by area.
- The AI agent works one scoped task at a time, commits locally, and stops at every gate listed in section 5. It does not push, merge, deploy, build a release, change versions, change signing, or apply Supabase migrations without explicit human approval.
- Where this document says a feature exists, the agent verifies it against the code before changing it. Where it says a feature is planned or broken, the agent treats it as work to do, not as done.

---

## 1. Locked v1 decisions

These are settled. Do not reopen, redesign around, or ask about them. They override anything later in this document that reads as open.

- Email and password sign-in only. No Sign in with Apple. No social login. No guest or anonymous browsing.
- Birthday is optional, not required.
- Location uses a 5-digit ZIP only. No ZIP+4.
- Age rating is 13+, driven by infrequent possible alcohol references in deals.
- iPad support is off. `ios.supportsTablet` is false. iPhone only.
- Share Deal ships in v1 on both platforms.
- v1 is a free pilot. No ads. No data sold.
- All paid surfaces are fully hidden behind `PAID_BILLING_ENABLED=false`. Nothing billing, pricing, upgrade, paywall, checkout, or subscription related is reachable in v1.
- Pilot businesses are capped to one location.

---

## 2. Current build and submission state

- The app is live on TestFlight. iOS build 6 was confirmed processing in TestFlight under version 1.0.0.
- iOS build 7 was queued on EAS (build id `d99d9604-de95-407e-9b13-288259d32e85`, version 1.0.0, build number auto-incremented from 6 to 7) with all five batches of iOS-specific bug fixes committed.
- The submit command ready to run on completion is `eas submit -p ios --id d99d9604-de95-407e-9b13-288259d32e85`.
- iOS is the active submission path. Android Play Store submission is queued for later.
- Remaining before iOS App Store review: install build 7 on a real iPhone, run the full on-device test pass (push, Liquid Glass appearance, Share Deal universal link), capture store screenshots from a real device, enter the drafted App Store Connect answers, confirm the demo account is review-ready end to end.

---

## 3. Reference identifiers

| Item | Value |
|---|---|
| App name | Twofer |
| iOS bundle id / Android package | `com.unvmex2.twoforone` |
| Apple Team ID | `L9DT756YSN` |
| ASC App ID | `6765769303` |
| ASC API key | `WSC6N6Q2JX` |
| APNs Push Key (held by EAS) | `H9VZ3V9TJ6` |
| Distribution cert validity | through May 2027 |
| Active provisioning profile | `683D7JMUSQ` |
| EAS project | `@unvmex2/twoforone` |
| Supabase project URL | `https://kvodhiqhdqnptqovovia.supabase.co` |
| Supabase Storage bucket for posters | `deal-photos` |
| AASA file | `https://www.twoferapp.com/.well-known/apple-app-site-association`, paths `/s/*`, appID `L9DT756YSN.com.unvmex2.twoforone` |
| Website | `https://www.twoferapp.com` (Vercel) |
| Mobile repo | `C:\Users\unvme\Downloads\twoforone` |
| Website repo | `C:\Users\unvme\Downloads\twoferwebsite\v0-twofer-landing-page` |
| Android upload keystore | `C:\Users\unvme\keys\twofer-upload-key.keystore`, alias `twofer-upload` |
| Demo / reviewer account | `demo@demo.com` — DECIDED 2026-06-10: delete this account and remove all demo code paths (demo login helper, canned AI responses in edge functions, seed scripts). Until that work lands it still exists and reaches both sides. |

---

## 4. Open items — all confirmed by Dan on 2026-06-10

All six items below are decided. Items 2 and 4 require code changes that have not been built yet; the decisions are recorded here and the code still reflects the old behavior until that work lands.

1. **Support email. RESOLVED: `support@twoferapp.com`.** This is the single public support email for the app, the store listings, and the website. The app constant (`lib/support-contact.ts`) and the Play submission pack already use it. The live privacy policy at `twoferapp.com/privacy` still shows `twoferadmin@gmail.com` (sections 9 and 13) and must be updated — the website is published from a separate repo, so this is a website task, not a mobile-repo task.

2. **Account and role model. DECIDED: hard role split, app-level lock.** One role per account, chosen once at signup. After the account exists there is no switching to the other side; login shows no role picker and routes by the account's stored role. Enforcement is app-level only — no database constraint. Existing accounts get their permanent role derived from data: any account that owns a `businesses` row becomes Business, all others become Customer. The demo account is to be deleted along with all demo code paths (see item on the reference table). NOTE: the current code still implements a soft switchable mode persisted in `profiles.app_tab_mode` (`lib/tab-mode.tsx`, picker in `app/auth-landing.tsx`); the lock is pending implementation.

3. **Share Deal feature flag name. CONFIRMED: `EXPO_PUBLIC_ENABLE_SHARE_DEAL`.** Set in `eas.json` in the preview, production, and dev-client-apk profiles. Read in exactly one place: `lib/runtime-env.ts` `isShareDealEnabled()`, which enables the feature only when the value is the exact string `"true"`.

4. **AI usage limits. DECIDED: 30 generations per month per AI feature, and 2 regenerations per deal creation.** Current code: ad variants and AI Compose already enforce 30 per month server-side via `supabase/functions/_shared/ai-limits.ts`; deal copy has its own 60 per month in `ai-generate-deal-copy` and must drop to 30; the regeneration cap is currently 5 on the client (`app/create/ai.tsx` `SOFT_REVISION_CAP`) and 10 on the server (`ai-generate-ad-variants` `MAX_REVISION_COUNT`) and must become 2 in both places. Pending implementation.

5. **Voice input audio retention. CONFIRMED: processed ephemerally, never stored.** Raw audio is decoded in memory inside `ai-compose-offer` and sent directly to OpenAI Whisper; it is never written to Storage or the database (only a SHA-256 hash of the first 4 KB is kept for cooldown dedupe). The text transcript is stored in `ai_generation_logs.voice_transcript`. Provider side follows the OpenAI API data policy: not used for training, retained up to 30 days for abuse monitoring. Store privacy disclosures can state: voice audio is not stored; the transcript is retained.

6. **Email confirmation flow. DECIDED: keep email confirmation; Dan configures Supabase later.** Dan will turn email confirmation on and set up the Supabase side (custom SMTP, the Confirm email toggle, and the redirect-URL allow-list) at a later date, before broad distribution. No app code change is needed — the client already handles both the confirmed and unconfirmed signup paths (`app/auth-landing.tsx`, `lib/auth-password-recovery.ts`, `app/auth-callback.tsx`).

---

## 5. Agent working rules and gate-based workflow

The repo carries `CLAUDE.md` and `AGENTS.md` at root. Those rules govern all agent work. The core rules are below.

**Hard gates. Stop and get explicit human approval before any of these.**
- Building any release (iOS or Android).
- Submitting to TestFlight, App Store, or Play.
- Pushing, merging, tagging, or resetting any branch.
- Deploying the website.
- Changing version or build numbers.
- Changing the bundle id, package id, or signing.
- Applying any Supabase migration.
- Exposing or printing any secret.

**Build and change discipline.**
- Work on a dedicated branch off a named safety checkpoint commit.
- Make the smallest possible change per task. One concern per commit.
- Commit locally. Do not push.
- When fixing an iOS-only bug, preserve existing Android behavior, and the reverse.
- After each change, validate with `npx tsc --noEmit` and a Metro bundle probe. Run the test suite (175 tests across 23 files at last count) and lint.
- Never run `expo run:android` or start an Android emulator on the dev machine. Do not use `subst` or junction workarounds.
- There is no local Supabase. Do not assume a local Supabase instance exists.
- iOS cannot be built or signed on the Windows dev machine. All iOS builds run on EAS cloud. All iOS device testing runs through TestFlight on a real iPhone.
- Preserve the single remaining EAS cloud credit. Prefer local Android builds where possible.
- Diagnose before building. Run a read-only audit and surface all issues before writing any fix. Review the full fix set for interactions and regressions before applying anything.

---

## 6. Product identity

### 6.1 Concept
Twofer is a real-time demand activation app for local businesses. It helps coffee shops, bakeries, cafes, and similar small businesses fill slow hours with limited-time, limited-quantity buy-one-get-one (BOGO) offers that consumers discover, claim, share, and redeem in person.

### 6.2 Positioning
Twofer is a live local discovery and demand-shaping platform, not a generic coupon app. It should feel like a real-time local deal app for consumers, a simple AI marketing tool for owners, a controlled scarcity system for slow hours, and a local network-effect product.

### 6.3 Value proposition
Twofer helps local businesses activate slow periods with controlled, time-limited BOGO offers, and helps consumers discover nearby local experiences before they disappear.

### 6.4 Strategic and emotional theme
Real-time demand activation for local businesses. Turning slow hours into shared moments through controlled scarcity and live discovery.

### 6.5 Problems solved
Independent businesses have predictable slow periods, thin margins, perishable inventory, and little time for marketing. Existing tools reach existing customers instead of bringing new ones in at the right time. Consumers want fast, timely, nearby value without digging through generic coupons.

### 6.6 Initial market
Start local and concentrated. Dallas-Fort Worth area, specifically Irving, Coppell, Grapevine, and Carrollton. Coffee shops first, then bakeries, cafes, and dessert shops with predictable slow periods and perishable goods.

### 6.7 Strategic constraint
v1 stays focused on local businesses, real-time offers, slow-hour demand, BOGO deals, AI-assisted creation, nearby discovery, QR redemption, and controlled scarcity. It does not become a Groupon clone, a general coupon marketplace, a delivery app, a restaurant loyalty app, or a food-waste liquidation app.

---

## 7. User types

### 7.1 Consumer
People looking for nearby local deals: students, commuters, workers, price-conscious customers willing to try new places. Consumers use the app for free. Success: open the app, see nearby active deals, understand what is available, claim a deal, show a QR code in store, redeem without confusion, and share a deal with a friend.

### 7.2 Business owner
Owners or operators of coffee shops, bakeries, and cafes. Success: set up a business profile, generate a real offer in under 60 seconds, edit the AI-generated content before publishing, set time window and quantity, publish, see claims and redemptions, redeem a customer QR with minimal staff training, and understand whether the offer worked.

---

## 8. Architecture

- **Frontend:** Expo SDK 54, React Native, TypeScript, Expo Router.
- **Backend:** Supabase. Postgres with row level security, Deno edge functions, Supabase Storage (`deal-photos` bucket).
- **Push:** Expo Push Service through `expo-notifications`. See section 15 for the corrected push architecture. This is not native Firebase on iOS.
- **Website:** `www.twoferapp.com` on Vercel. Hosts the public site, legal and support pages, the delete-account page, the `/s/` share preview route, and the AASA and assetlinks files.
- **Builds:** EAS cloud for iOS. Local Gradle or `npx expo run:android` plus direct Gradle for Android AAB and APK. EAS local builds are not supported on Windows.

---

## 9. Navigation

### 9.1 Consumer
Home or Live Deals, Map or Discover, Claimed Deals or Wallet, Favorites, Profile or Settings.

### 9.2 Business
Dashboard, Create Deal or AI Create, Active Deals, Redeem or Scan, Business Profile, Settings.

### 9.3 Shared
Login, signup, account settings, support, privacy, terms, delete account, notification settings, location permissions.

### 9.4 Entry rule
The app opens to a branded login screen as the initial route. No feed, deals, or content appear before sign-in. Role model is decided (section 4, item 2): the role picker appears at signup only; login routes by the account's stored role with no picker.

---

## 10. Consumer features

### 10.1 Onboarding
Low friction. Sign up or log in, select the consumer experience, request location permission at the right moment, request notification permission after explaining value, set a deal radius, and optionally favorite businesses.

Onboarding screens confirmed in the build:
1. Language selection: English, Spanish, Korean. Default English.
2. Location: GPS or enter a 5-digit ZIP. Valid Texas ZIPs such as 75063 must be accepted.
3. Radius: 1, 3, 5, or 10 miles. Default 3.
4. Notification preference. Must not crash if permission is denied.
5. On completion, navigate to the feed.

Permission copy must explain why. Location is for showing nearby deals and relevant nearby alerts, not unnecessary tracking. Notifications are for live BOGO alerts and favorite-business alerts, controllable later.

### 10.2 Home feed
Shows the most relevant live deals immediately. Large deal cards, roughly half-screen height, image-forward, not a dense list.

Each card shows business name, offer title, offer image, distance or location context, time remaining, quantity remaining, a live-now urgency cue, and a clear Claim button. The feed handles closed and expired states and shows a friendly empty state.

Image resolution uses `resolveDealPosterDisplayUri()`, which builds a public URL from `deals.poster_storage_path`, and falls back to a generic coffee photo if no poster exists yet. The poster usually lands 10 to 15 seconds after publish.

Scarcity must be real. Counts and timers reflect actual backend state. No fake countdowns or fake low-stock cues.

### 10.3 Map and location discovery
Map view of nearby active deals, radius-based, with business pins and deal preview cards from pins, opening into deal detail. Graceful fallback when location permission is denied, including manual location or ZIP entry. Distance sorting. Favorite-business visibility. The app must not break when location is unavailable. The map should prioritize live deals and stay uncluttered.

### 10.4 Deal detail
Business name, address, image or logo, offer image, offer title, offer description, BOGO terms, time window, quantity remaining, distance, expiration status, Claim button, Share Deal button when enabled, directions link, and redemption instructions.

The directions link must be guarded so a missing or malformed address cannot crash the screen.

Required claim states the screen must handle: available, already claimed by this user, sold out, expired, not started yet, business closed, user not logged in, network error, claim success, claim failure. Users must never have to guess what they get, what they must buy, or when the deal ends.

### 10.5 Claim flow
On Claim, the app checks authentication, availability, time window, and quantity remaining, then creates a claim with a unique code and token, displays a QR code, updates remaining quantity, and prevents unintended duplicate claims.

Claim limits enforced server side: one active claim per business at a time, and one new claim per business per calendar day. After claiming, show the QR code, the business name, the offer title, the expiration time, the instruction to show the QR at checkout, a send-to-a-friend option where applicable, and a path back to the claimed deal later.

Claims carry a status of claimed, redeemed, expired, or canceled, a timestamp, and an expiration tied to deal rules. Claims must not expose private auth tokens.

### 10.6 QR redemption
Consumer sees a QR code, a 6-character short code, the deal terms, expiration status, the business name, and instructions. The business scans the QR, validates the claim, and marks it redeemed, with clear states for invalid, expired, already redeemed, and wrong business. Use Deal flows through a slide-to-confirm action to a full-screen visual pass for in-store redemption.

Redemption must be usable by a cashier with minimal training. Fraud prevention must block reusing a redeemed QR, redeeming an expired deal, redeeming at the wrong business, guessing claim codes, and sharing codes that expose sensitive data.

### 10.7 Wallet (claimed deals)
A list of active claimed deals with quick QR access, plus expired and redeemed claims, claim status, business name, expiration time, and directions. Consumers should never have to dig through notifications to find a QR.

### 10.8 Favorites
Favorite and unfavorite a business, view favorites, receive notifications from favorites, and prioritize favorite-business deals on the home feed. Users must be able to manage favorite-driven notifications.

### 10.9 Consumer notifications
Types: new nearby deal, new deal from a favorite business, deal expiring soon, claimed-deal reminder, shared-deal received where supported, and opted-in business updates. Rules: respect permission and location preference, do not spam, deep-link into the correct deal, and handle expired deals gracefully when opened late. Copy is short, specific, and action-oriented, for example "BOGO latte live near you" or "Only 5 left at Main Street Coffee."

### 10.10 Reporting
Consumers can report a deal or business. The report modal must handle the keyboard correctly on iOS.

---

## 11. Business features

### 11.1 Onboarding
Sign up or log in, select the business experience, create or claim a business profile, enter name, address, category, logo or image, hours, and contact details, accept terms, start the free pilot, and create a first offer.

**AI business-data rule, must fix.** During testing the app appeared to let AI invent business information. The base branch `codex/fix-business-verified-lookup` exists for this. The required behavior:
- AI must never invent business facts.
- If business lookup is unavailable, say so clearly.
- If external business search is used, show source-backed fields or ask the owner to confirm.
- The owner must confirm business details before saving.
- AI-generated business descriptions must be editable.
- The UI must distinguish AI suggested from owner verified.

Business profile fields, required: name, address, phone, category, logo or photo, hours, short description, owner contact email, and status (pending, active, disabled, demo, test). Website is optional. Optional later: POS provider, menu link, social links, store photos, pickup instructions, redemption policy. Latitude and longitude are stored for maps and nearby sorting.

### 11.2 AI deal creation
Goal: create a high-quality BOGO offer in under 60 seconds. Owner can upload or select a product image, enter the product or offer type, choose the BOGO structure, set start and end time, set quantity and restrictions, generate AI title, description, notification copy, and ad copy, preview the consumer-facing deal, and edit everything before publishing.

There are two creation paths in the code:
- **Quick Deal** at `app/create/quick.tsx`. The main path. Optional AI title suggestion plus automatic AI poster generation.
- **AI Compose** at `app/create/ai.tsx`. Full AI offer composition with photo, text, and ad variants.

Quick Deal flow:
1. Owner fills title, offer hint, price, end time, max claims.
2. Optional Suggest Title with AI calls `aiGenerateDealCopy()` in `lib/functions.ts`, which calls the `ai-generate-deal-copy` edge function and returns title, promo_line, and description. The title auto-fills.
3. On Publish, the client runs `assessDealQuality` and `validateStrongDealOnly`.
4. INSERT into the `deals` table returns the deal id and the owner is routed to the dashboard immediately.
5. Fire-and-forget `aiGenerateDealPoster(dealId)` generates the poster in the background.

**AI quality requirements.** The AI must use full context, not just the image: business name, category, tone, product name, product type, offer structure, time window, quantity, neighborhood, slow-hour goal, image description, owner notes, existing profile data, and menu items when available. The AI must avoid generic hype, unsupported claims, fake facts, fake menu details, overpromising, long copy, and confusing BOGO terms. Output should be specific, local, clear, short, human, and honest.

Good example: "BOGO iced vanilla latte from 11:30 to 1. Only 12 available today at Lakewood Coffee." Bad example: "Enjoy a delicious treat today with this amazing limited-time offer."

Required AI output fields: deal title, short description, push notification title, push notification body, in-app promotional copy, optional tone variants, suggested tags, and optionally a suggested time window and quantity if the owner asks for help. The owner can always edit title, description, quantity, time, terms, image, and notification copy.

The `ai-generate-deal-copy` path should accept the business profile context and return 2 to 3 distinct ad variants, each with title, promo_line, description, and a suggested deal structure, labeled by a style lane such as value-focused, neighborhood feel, or premium.

### 11.3 Deal controls
Owner sets offer title, description, category, product image, start date and time, end date and time, quantity available, redemption instructions, terms, active state, shareable flag, notifications flag, and reusable-as-template flag. The flow should feel like a simple operational tool, not a complex ad manager.

### 11.4 Publishing
States: draft, preview, scheduled, live, paused, sold out, expired, canceled. Validation before publish: profile complete enough, title present, terms clear, start before end, positive quantity, image present or fallback, required backend fields present, notification copy ready if push is on. After publish: route to the dashboard not back to Create, show a success banner, show live deal performance, and offer a consumer preview, plus pause and duplicate.

### 11.5 Dashboard
Show whether Twofer is working. Metrics: active offers, claims, redemptions, views, view-to-claim and claim-to-redemption conversion, remaining quantity, expired claims, optional revenue proxy and waste-saved estimate, customer-acquisition proxy, privacy-safe new versus repeat, monthly claims and redemptions, best-performing offer, and slow-hour performance. Metrics must default safely to zero and never show undefined, NaN, or broken values. Prioritize what is live now, how many claimed, how many redeemed, whether it worked, and what to do next.

### 11.6 Reusable and scheduled offers
- Duplicate a previous offer, save as template, reuse a weekday midday offer, change quantity or time quickly, and schedule for a future date.
- Templates store item name, deal structure, ad copy snapshot, and price, sorted by `last_used_at` descending. Reuse regenerates fresh AI copy. Time, duration, and max claims are always set fresh.
- Scheduling toggle: Go Live Now (default) versus Schedule for Later. Scheduled deals carry status `scheduled` and a `scheduled_start_at`, and poster generation defers to go-live. The `activate-scheduled-deals` cron flips due deals to `live` and triggers poster generation. Cancel sets status `cancelled` as a soft delete.
- Recurring deals: None, Weekdays (Mon to Fri), Every Day, Weekly, or Custom day-of-week toggles. The `generate-recurring-deals` cron runs daily, creates only that day's deal, never pre-generates future rows, generates fresh copy, and hands off to the scheduled pipeline. The dashboard Recurring section supports Pause, Resume, Cancel.
- The first key trial window is weekday 11:30 AM to 1:00 PM, based on owner interviews showing a predictable midday gap.

### 11.7 Business redemption tools
Open scanner, scan the consumer QR, validate the deal, see claim details, mark redeemed, see error states, and view redemption history. Scanner error states: already redeemed, expired, invalid code, wrong business, deal not live, network unavailable, camera permission denied, claim not found. A manual code-entry fallback must exist for when the scanner fails.

### 11.8 Business notifications
Deal went live, deal sold out, new claims, redemption summary, end-of-day performance, trial ending, payment required (later), and error with a published offer. Useful, not noisy.

---

## 12. AI system inventory

Edge functions and client wrappers to verify and finish:
- `ai-generate-deal-copy` (GPT). Input: item name plus business profile context. Output: 2 to 3 ad variants with title, promo_line, description, suggested structure, and a style lane.
- `ai-generate-deal-poster` (DALL-E 3). Generates a 1024x1024 food image, uploads the PNG to the `deal-photos` bucket, and patches `deals.poster_storage_path`. Skips silently if a poster already exists. Fire-and-forget. Currently swallows errors, which should be reviewed.
- AI Compose composition for `app/create/ai.tsx`.
- Menu extraction from a photo.
- Image polish.
- Voice input transcription. Retention confirmed (section 4, item 5): audio is ephemeral, only the transcript is stored.
- `activate-scheduled-deals` and `generate-recurring-deals` cron functions.

Client wrappers live in `lib/functions.ts`, including `aiGenerateDealCopy()` and `aiGenerateDealPoster()`.

Usage limits (decided, section 4 item 4): 30 generations per month per AI feature and 2 regenerations per deal creation. Monthly limits are already enforced server-side via `ai_generation_logs` counts; the deal-copy 60-per-month and the 5-client / 10-server regeneration caps still need to be brought in line. Token usage is logged per call in `ai_generation_logs`, and 60-second generation cooldowns (10 seconds for revisions) are enforced server-side.

---

## 13. Deal mechanics and quality gate

- Supported structures: BOGO, Buy 2 Get 1, 50% off second item.
- Quality gate: weak deals such as a 20% discount are rejected at publish. Strong deals such as BOGO are accepted. Enforced by `assessDealQuality` plus `validateStrongDealOnly`.
- Deal status values: draft, scheduled, live, ended, expired, cancelled, plus the publishing states in 11.4.
- Poster pipeline runs after insert for immediate deals, or at go-live for scheduled deals.

---

## 14. Share Deal

### 14.1 Purpose
Consumer-side network effects. One user sends a live deal to a friend, who can claim their own copy.

### 14.2 Behavior
- Share Deal button on deal detail, and a send-to-a-friend option in the QR modal.
- Create or reuse a safe share code, then open the native share sheet.
- Shared URL format: `https://www.twoferapp.com/s/SHARECODE`.
- The shared text must never include QR tokens, claim codes, redemption codes, auth tokens, or private user data.
- Controlled by the `EXPO_PUBLIC_ENABLE_SHARE_DEAL` feature flag (confirmed, section 4 item 3). When the flag is off or missing, the Share Deal UI is hidden and no deal_shares query runs.

### 14.3 Flow
User taps Share Deal, the app creates or reuses a safe share code, the native share sheet opens, the friend receives the URL, the URL opens the app deep link or the website preview, and the friend claims their own deal if it is still available. The recipient never receives the original user's QR code.

### 14.4 deal_shares table
Stores a safe share code, associates the sharing user with the deal, prevents duplicate codes, allows reuse for the same user and deal, and allows anonymous public read of safe non-private preview fields only. It never exposes private user data, auth data, QR tokens, claim codes, or redemption codes.

### 14.5 Website preview
Route `https://www.twoferapp.com/s/SHARECODE` shows business name, offer, image, and location context, plus an app CTA. It handles expired, invalid, sold-out, inactive, disabled, and network states. It exposes no private data and supports future app store links. The AASA at the well-known path is live and scoped to `/s/*` for `L9DT756YSN.com.unvmex2.twoforone`.

---

## 15. Notifications and push infrastructure (corrected)

This section supersedes any earlier Firebase-on-iOS framing.

**Architecture.** Push runs through Expo Push Service via `expo-notifications`. Device tokens are Expo push tokens. The server trigger is the `send-deal-push` Supabase edge function, which sends through Expo, not directly through FCM or APNs.

- **iOS.** Delivery uses the APNs key `H9VZ3V9TJ6`, which is held by EAS. There is no native Firebase iOS app in the push path. There is no `GoogleService-Info.plist` in the push path. A `GoogleService-Info.plist` was briefly added and then removed as unnecessary. Do not reintroduce a Firebase iOS push setup.
- **Android.** `expo-notifications` relies on FCM for transport, so `google-services.json` remains required for Android delivery. Confirm whether it is committed or stored as an EAS secret before diagnosing any build failure.

**Rules.** Ask for permission with context. Save the token securely and associate it with the user. Handle token refresh. Never send push before consent. Deep-link taps to the correct screen: deal detail for consumers, the claimed-deal QR where relevant, and the dashboard or active deal for owners. Handle expired deals gracefully. Avoid duplicates.

**Permissions cleanup, already applied on Android.** The final Android permission set is `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `ACCESS_NETWORK_STATE`, `CAMERA`, `INTERNET`, `MODIFY_AUDIO_SETTINGS`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `RECORD_AUDIO`, `VIBRATE`. Removed: `SYSTEM_ALERT_WINDOW`, foreground service permissions, and legacy storage permissions. Keep this set unless a feature genuinely needs more.

---

## 16. Deep links and website

- Main site: `https://www.twoferapp.com`, on Vercel.
- Required pages: home or landing, privacy policy, terms, support, delete account, the `/s/` share preview route, and app store links once available.
- The same public support email appears on the app and the website: `support@twoferapp.com` (confirmed, section 4 item 1). The live privacy policy still shows `twoferadmin@gmail.com` and needs a website update.
- Share deep links resolve as described in section 14.
- iOS universal links use the AASA file. Android App Links use intent filters for `https://www.twoferapp.com/s` plus an `assetlinks.json` Digital Asset Links file. The assetlinks file needs the Play App Signing key SHA-256 fingerprint, which is only available after Play App Signing enrollment. Until then the file carries a placeholder.

---

## 17. Authentication and account management

- Email signup, email login, session persistence, logout, password reset, delete account, and links to privacy and terms.
- Wired to Supabase auth: `signUp`, `signInWithPassword`, `resetPasswordForEmail`. Every flow shows a friendly error on failure. Missing Supabase URL or anon key shows a clear error rather than crashing.
- Account stores role. Hard role split decided (section 4, item 2): one role per account, picked at signup, no switching after.
- Delete-account path exists in the app and on the website.
- Auth fields carry proper autofill hints.

**Known broken item.** Email confirmation does not work for TestFlight users. The cause is that Supabase default SMTP is test-only and the Confirm email toggle is on, so confirmation emails link nowhere. DECIDED 2026-06-10 (section 4, item 6): Dan will turn email confirmation on and configure the Supabase side (custom SMTP, Confirm email toggle, redirect-URL allow-list) at a later date, before broad distribution. No app-code auth changes are needed; the client handles both toggle states. The demo-account exemption disappears when the demo account is deleted.

The app must not expose user auth tokens, QR redemption tokens, private user details, business owner private contact info unless intended, or share-sender private details.

---

## 18. Data model

The agent verifies these against the live schema and the generated Supabase types before relying on them. Field names below are the intended shape, not a guaranteed match.

**profiles / users:** id, email, role, display name, notification preferences, location preferences, created at, updated at.

**businesses:** id, owner user id, name, address, latitude, longitude, phone, website, category, description, image, logo, hours, status, trial status, created at, updated at.

**deals:** id, business id, title, description, image, offer type, price, start time, end time, scheduled_start_at, quantity total, quantity claimed, quantity redeemed, status, share enabled, notification enabled, terms, poster_storage_path, created by, created at, updated at.

**claims:** id, deal id, business id, user id, claim code, qr token, status, claimed at, redeemed at, expires at, redeemed by business user id.

**deal_shares:** id, share code, deal id, shared by user id, status, created at, last used at.

**deal_templates:** id, business id, item name, deal structure, ad copy snapshot, price, created at, last_used_at.

**recurring_deals:** id, business id, template id (nullable), item name, deal structure, ad copy context, price, recurrence type, recurrence days, start time, duration minutes, quantity limit, status, created at.

**favorites:** user id, business id, created at.

**device tokens:** user id, token, platform, enabled, created at, updated at.

**metrics / events:** event id, user id (nullable), business id, deal id, event type, metadata, timestamp. The telemetry hook posts sanitized app errors to an `ingest-analytics-event` endpoint.

---

## 19. Security, privacy, and store data declarations

### 19.1 QR and claim security
QR codes are unique per claim, hard to guess, expiring, invalid after redemption, scoped to the correct business, and avoid exposing raw database ids where possible.

### 19.2 Share security
Share links use safe codes, expose public preview data only, never expose the original claimer's QR code, and never let one user redeem another user's claim.

### 19.3 Row level security
Users see only their own private claims. Businesses manage only their own deals. Public share preview reads safe deal fields only. Anonymous users cannot read private user or claim data. Dashboard metrics are scoped to the owning business.

### 19.4 No secret leakage
Never expose the Supabase service role key, APNs key, App Store Connect keys, QR secret generation logic, auth tokens, or private customer data.

### 19.5 Privacy data declarations (must match across iOS App Privacy and Play Data Safety)
All collection is for app functionality, none for tracking, none sold, all encrypted in transit. There is no App Tracking Transparency prompt because tracking is No across all types.

- Location: approximate and precise, both optional, with a ZIP alternative to GPS.
- Personal info: email (required), business owner or contact name, user IDs, business address (shown publicly with deals), business phone (business listing info), optional consumer birthdate and age range, ZIP.
- Photos: deal photos, business logos, menu photos. Business-posted images appear publicly.
- Audio: voice recordings from AI Compose voice input, sent to a transcription provider. Retention confirmed (section 4, item 5): raw audio is processed ephemerally and never stored; the text transcript is retained.
- App activity: deals viewed, claimed, redeemed, shared, saved, and businesses viewed, favorited, reported, plus user-generated content such as deal titles, descriptions, prices, menu items, business descriptions, and reports.
- Diagnostics: sanitized error and diagnostic telemetry only (source, fatal flag, error name, error hash, app version, build, platform). Not raw crash logs and not identity-linked. Declared as Other Diagnostic Data, not Crash Data. There is no crash reporting SDK and no raw crash log flow.
- Device or other IDs: Expo push tokens for notification delivery, not for tracking or ads.

Data deletion paths: consumer Settings, business Account tab, the in-app delete-account flow, and the website delete-account page.

---

## 20. Design system and UI guidelines

### 20.1 Brand feel
Local, friendly, modern, fast, trustworthy, deal-focused, simple for busy owners, exciting for consumers.

### 20.2 Visual priorities
Emphasize live deals, scarcity, proximity, clear offer terms, simple actions, QR redemption, and business control. White background, clean layout, generous spacing. Deal cards are large, around half-screen, and image-forward. No ads anywhere. No paid surface reachable while the billing flag is off.

### 20.3 Consumer UI principles
Visual, fast, map-aware, deal-first, low friction, mobile-first, and clear about expiration and quantity.

### 20.4 Business UI principles
Simple, operational, fast, owner-controlled, free of marketing jargon, and focused on creating and measuring offers.

### 20.5 Copy guidelines
Use simple, direct language. Good: "Live now", "Only 8 left", "Claim Deal", "Show this QR code at checkout", "Send to a friend", "Create offer", "Publish deal", "Deal expired". Avoid generic hype, long explanations, confusing discount language, fake urgency, and unclear BOGO terms.

### 20.6 Accessibility
Readable text on small screens. Tap targets large enough. Important information not conveyed by color alone. Clear text in error states. High contrast on the QR screen. Obvious loading states. Empty states that explain the next step.

### 20.7 Loading, empty, and error states
Every main screen needs loading, empty, error, and where relevant offline or retry states. Examples: "No live Twofers near you right now. Check back soon or expand your radius." and "You don't have a live offer yet. Create one in under a minute." and "Claim a live deal to see your QR code here."

### 20.8 iOS-specific rendering rules
- Liquid Glass: building against the iOS 26 SDK applies the new look to native controls by default. Review key screens. Opt out if it breaks the design, then retest.
- SF Symbol icons need a fallback for older iOS such as 15.1 so icons do not vanish.
- ZIP input uses numeric entry with a working Done or dismiss accessory. A bare number pad strands the user on a 5-digit field.
- Birthday picker is a bottom-sheet modal with explicit Done and Cancel. It must not silently commit a default date on open.
- Deal-creation date and time pickers include numeric keyboard accessories so values can be entered and dismissed.
- Camera permission copy must describe the app's full camera use, not only QR scanning.

### 20.9 Role label sizing
The role selection on the signup screen (section 4, item 2) must fit its labels, such as Shopper and Business, on small screens without wrapping, truncating, or rendering awkwardly.

---

## 21. Localization

Required languages: English, Spanish, Korean. Any new user-facing copy goes into localization files, never hardcoded. If Korean is enabled for a store listing, Korean release notes may be required.

---

## 22. App Store and Google Play readiness

### 22.1 Identity
App name Twofer. iOS bundle id and Android package `com.unvmex2.twoforone`.

### 22.2 Required store assets
App icon, splash screen, screenshots, description, privacy policy URL, support URL, delete-account URL, contact email, demo account credentials, and release notes.

### 22.3 Android readiness
Build an AAB, not an APK. EAS production was configured to output AAB. Test through internal testing. Validate that testers install the latest build. Android `versionCode` must be incremented manually for every Play upload since EAS remote autoIncrement is not used on the local build path. Decide whether R8 or ProGuard is enabled and upload the mapping file if obfuscation is used. Closed testing applies on a personal Play developer account, which adds calendar time. The `assetlinks.json` file needs the Play App Signing SHA-256 fingerprint, available only after enrollment.

### 22.4 iOS readiness
EAS iOS production build. Upload to App Store Connect. Test through TestFlight on a real iPhone. Push uses the Expo path with the APNs key on EAS, not Firebase. The privacy manifest `PrivacyInfo.xcprivacy` is present and reconciled to the declared data types. The iOS icon is 1024 by 1024 RGB with no alpha channel. Associated Domains entitlement is set for `applinks:www.twoferapp.com`. Apple requires builds made with the current Xcode and iOS SDK, which on Windows means EAS cloud and a current enough Expo SDK.

### 22.5 Permissions justification
Location, notifications, camera for QR scanning, and internet. Do not request a permission before the user understands why.

---

## 23. Testing requirements

### 23.1 Consumer flows
Signup, login, role selection at signup, location denied, location allowed, notifications denied, notifications allowed, view home deals, view map, claim deal, show QR, redeem QR, share deal, open a shared link, favorite a business, logout, delete account.

### 23.2 Business flows
Signup, login, create business profile, AI create deal, edit AI copy, publish deal, dashboard success banner, active deal metrics, scan QR, redeem QR, handle invalid QR, pause or expire deal, duplicate deal.

### 23.3 Backend
Quantity decrements correctly, no over-claiming, expired deals cannot be claimed, redeemed QR cannot be reused, share links do not expose private data, RLS protects data, push tokens save correctly, notifications deep-link correctly. Enforce the one-active-claim-per-business and one-new-claim-per-business-per-day limits.

### 23.4 Store readiness
Android AAB, iOS build, app icon, splash, permissions, privacy links, support links, account deletion, demo accounts, push notifications, deep links.

### 23.5 Native iOS testing reality
iOS-only bugs cannot be validated on the Windows dev machine. Validate through TestFlight with a real-device tester. Web or localhost AI testing tools cannot assert native iOS behaviors such as keyboard accessories, autofill, or modal pickers. For a single app, TestFlight with a real tester is more practical than a device cloud service.

### 23.6 Bug workflow
Tester reports with screenshots, device, build number, and steps. Developer fixes one scoped item. Run typecheck and tests. Build a new iOS build or Android AAB. Upload. Testers install the latest build. Regression test the changed flow.

---

## 24. Business model

Consumers free. Businesses get a free trial or free tier. The free tier should allow one active offer to prove value. Paid Twofer Pro is planned at around $30 per month, with optional promotion boosts later. Possible future partnerships with POS, payment, delivery, universities, or local groups. All of this is planned, not in v1. In v1, every paid surface is hidden behind `PAID_BILLING_ENABLED=false`.

Free trial matters because owners are price sensitive and risk averse. The product must prove it creates an offer quickly, brings in customers, makes redemption easy, and produces useful metrics.

If billing is added later, the cleaner path is to charge businesses on the web at `twoferapp.com` rather than in the app, so the app only reflects whether a subscription is active. In-app digital subscriptions would pull the app into Apple In-App Purchase and Google Play Billing. Adding payment screens later is a normal update, not a resubmission, and does not repeat the initial closed-testing wall on Android.

---

## 25. Known project context

### 25.1 Repositories
Mobile app: `C:\Users\unvme\Downloads\twoforone`. Website: `C:\Users\unvme\Downloads\twoferwebsite\v0-twofer-landing-page`.

### 25.2 Branches and workstreams seen in history
`fix/production-clean-copy`, `fix/current-app-with-share-isolated`, `feature/share-deal-mvp`, `feature/share-deal-preview`, `ios-agent-fixes` (based on `codex/fix-business-verified-lookup`).

### 25.3 Completed or in-progress work
Share Deal mobile feature and its Supabase migration, the website Share Deal preview, notification consent fix, the `send-deal-push` edge function, a store-readiness audit, Android internal testing prep, iOS TestFlight prep, website legal and support page updates, the account-deletion page, privacy and terms pages, the iOS icon alpha fix, the privacy manifest, Associated Domains, the five batches of iOS-specific bug fixes, and the AASA deploy.

### 25.4 iOS fix batches already landed on `ios-agent-fixes`
Batch 1 ZIP input fixes across onboarding, consumer profile, and settings. Batch 2 iOS birthday picker bottom-sheet modal. Batch 3 SF Symbol icon fallback for iOS 15.1. Batch 4 deal-creation date and time pickers with numeric keyboard accessories. Batch 5 camera permission copy, auth autofill hints, report-modal keyboard handling, voice recording quality, directions URL guard, and location fallback messaging.

### 25.5 Build safety
See section 5. Do not commit, push, merge, tag, bump versions, change ids or signing, apply migrations, or build a production release unless explicitly asked.

---

## 26. MVP definition

### 26.1 Consumer MVP
Signup and login, the consumer experience, location or manual area, a home feed of live deals, deal detail, claim deal, QR code, claimed-deal wallet, map discovery, favorites, push notifications, Share Deal, basic profile and settings, and support, privacy, and delete-account.

### 26.2 Business MVP
Signup and login, the business experience, business profile setup, AI-assisted deal creation, editable AI copy, time and quantity controls, publish deal, active-deal dashboard, QR scanner, redemption validation, metrics, free pilot support, and support, privacy, and delete-account.

### 26.3 Website MVP
Landing page, support page, privacy page, terms page, delete-account page, share preview page, app store links when live, and the confirmed support email.

---

## 27. Future features

Not in v1. Business: POS integration, payment integration, promotion boosts, advanced AI recommendations, customer segmentation, repeat-customer analysis, weekly templates, multi-location support, staff accounts, business verification. Consumer: referral rewards, friend activity, saved routes, personalized preferences, dietary filters, loyalty, and reviews only if needed. Growth: university partnerships, local events, food-waste nonprofit partnerships, case studies, neighborhood campaigns, QR flyers.

---

## 28. Developer priority order

1. Protect the MVP flows: consumer sees a deal, claims it, gets a QR, business redeems the QR, business sees metrics.
2. Fix AI quality: use full business and offer context, stop generic copy, never invent business facts, require owner confirmation and editing.
3. Harden Share Deal: safe share code, website preview, deep-link handling, no private data, correct feature-flag behavior.
4. Harden notifications: consent flow, token storage, deep links, nearby and favorite logic, expired-deal handling. Confirm the Expo push path end to end on a real iPhone.
5. Store readiness: demo accounts, legal pages, support email, app permissions, Android and iOS testing, screenshots and release notes.

Before any store submission, also resolve the email confirmation flow (section 17) and the open items in section 4.

---

## 29. North star

Twofer should make it easy for a local business to launch a live, limited BOGO deal in under a minute, and easy for a nearby consumer to discover, claim, share, and redeem that deal before it disappears.
