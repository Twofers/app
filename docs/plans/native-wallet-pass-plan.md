# Native Wallet Pass — "Your Twofer Card" (Apple Wallet + Google Wallet)

**Status (updated 2026-07-12): backend migration, secrets, Google class, and all 73 current Edge Functions are deployed to production. Google and Apple pass issuance were live-verified. The remaining release gates are Google Wallet publishing approval plus Android device QA, and an iOS EAS/TestFlight build plus real-iPhone QA of the native PassKit presentation.**

Date: 2026-07-11
Owner: Dan (approvals, accounts) + agent (code)

## As-built notes (2026-07-11)

What exists in the working tree (all local, gates green — typecheck, lint, typecheck:functions, 1522 tests incl. 39 new):

- `supabase/migrations/20260811120000_wallet_passes.sql` — **APPLIED to prod 2026-07-11** (`supabase db push`; RLS smoke green; verified anon REST read → HTTP 401, so default-deny confirmed). Registrations are keyed by `user_id` (simpler FK than the serial-number keying sketched below).
- **Official Google badge downloaded 2026-07-11**: canonical unmodified SVG+PNG originals in `assets/google-wallet/` (enUS + esUS primary variant); `lib/google-wallet-badges.ts` embeds the exact SVG markup (machine-escaped, byte-identical) and `components/add-to-wallet-button.tsx` renders it via `react-native-svg` `SvgXml` (crisp vector, no distortion). Korean has no official Google button → falls back to the English badge per Google's own guidance.
- **Card logo uploaded 2026-07-11**: the production launcher icon (`twofer-icon-1024.png`, penguin) resized to 660×660 and uploaded to the public `business-logos` bucket. Public URL (verified HTTP 200 image/png, SHA-256 round-trip match, 660×660): `https://kvodhiqhdqnptqovovia.supabase.co/storage/v1/object/public/business-logos/app/twofer-card-logo.png`, configured through `WALLET_PASS_LOGO_URL`. The later owner-scoped logo policy migration is applied in production, so the earlier broad authenticated-write warning is resolved.

### Apple part 1 BUILT + LOCALLY VERIFIED 2026-07-11

Pass Type ID `pass.com.unvmex2.twoforone` (Team L9DT756YSN) registered by Dan; cert verified to pair with the agent-generated key and chain to Apple WWDR G4. 5 Apple secrets set in prod (`APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID`, `APPLE_PASS_CERT_PEM_B64`, `APPLE_PASS_KEY_PEM_B64`, `APPLE_WWDR_CERT_PEM_B64`).
- New edge modules: `_shared/apple-pass-json.ts` (pure pass.json builder, vitest-covered), `_shared/apple-pass-images.ts` (icon+logo @1/2/3x, base64 from twofer-icon-1024.png), `_shared/apple-pkpass.ts` (node-forge PKCS#7 detached SHA-256 sign + fflate zip, via esm.sh), `_shared/apple-wallet-issue.ts` (kill-switch-gated, mints stable `apple_serial_number`, static pass — no webServiceURL yet).
- `wallet-pass-issue` Apple branch now returns `application/vnd.apple.pkpass` (was 501).
- **Signing proven** (spike) + **full .pkpass verified**: ran the REAL `apple-pkpass.ts` under Deno → 36 KB pass; openssl `smime -verify` succeeds, manifest SHA-1 matches every file, pass.json is valid UTF-8 with correct identity/brand colors/QR (`twofer://redeem/sc/…`)/expiry/location. All gates green (typecheck, lint, 1522+ incl. new Apple tests, typecheck:functions).
- **DEPLOYED + LIVE-VERIFIED on prod 2026-07-11**: `wallet-pass-issue` (Apple branch) called as the smoke shopper → HTTP 200 `application/vnd.apple.pkpass` (35.9 KB, valid zip); openssl confirms signature verifies against manifest, **signer cert = our `pass.com.unvmex2.twoforone` / Team L9DT756YSN issued by WWDR G4**, manifest SHA-1 matches files, pass.json identity + brand colors correct, serial minted+persisted (df25fff0-…), "No active deal"/no barcode (correct for the claimless test user).
### Apple part 3 (iOS button) BUILT 2026-07-12 — needs an iOS build to test

- `lib/wallet-pass-functions.ts` `fetchAppleWalletPassBase64(locale)` fetches `wallet-pass-issue` directly and returns the signed binary as base64 without routing it through Supabase's JSON-oriented invoke helper.
- `modules/twofer-passkit/` is a local Expo Apple module. It renders Apple's system `PKAddPassButton`, validates the signed bytes as a `PKPass`, and presents `PKAddPassesViewController`. This follows Apple's in-app guidance and removes the interim custom badge/share-sheet path.
- `components/add-to-wallet-button.tsx` now branches by platform: **iOS** uses the native PassKit button/controller; **Android** keeps the official Google Wallet SVG and signed save link. Both remain surfaced in the QR modal and active Wallet card.
- The module is discovered by Expo autolinking, TypeScript passes, and focused wallet tests cover the system button/controller contract. Windows cannot compile or run the Swift path.
- **To test on Dan's iPhone**: explicitly approve an iOS EAS/TestFlight build with `EXPO_PUBLIC_ENABLE_NATIVE_WALLET_PASS=true`, then verify add/cancel, the installed card, claim/redeem/release/expiry updates, and actual APNs delivery. Store submission remains a separate approval.

### Apple part 2 (auto-update) BUILT + VERIFIED 2026-07-11

- APNs push authenticates with the **Pass Type cert via mTLS** (spiked: APNs returned BadDeviceToken = cert accepted) — no .p8 key needed. `_shared/apple-apns.ts` (`Deno.createHttpClient({cert,key})`, empty background push, drops dead tokens on 410/BadDeviceToken/Unregistered).
- New `wallet-pass-webservice` fn (registered in config.toml, verify_jwt=false) implements the full PassKit REST protocol: register / unregister / list-updated / get-latest-pass / log. Auth = `ApplePass <token>` where token = HMAC-SHA256(SERVICE_ROLE_KEY, "wallet-pass:<userId>") — stable across re-issues, no stored secret (`_shared/apple-pass-auth.ts`, vitest-covered). Apple env moved to `_shared/apple-pass-env.ts`; `buildAppleWalletPassBytes` serves the latest pass without bumping updated_at.
- Issued passes now carry `webServiceURL` (SUPABASE_URL/functions/v1/wallet-pass-webservice) + the auth token. `syncWalletPassForUser` now bumps the Apple pass version + pushes every registered device (Google + Apple both handled, independently).
- **DEPLOYED + LIVE-VERIFIED on prod**: simulated Apple's calls end-to-end — register→201, get-pass(wrong token)→401, get-pass→200 vnd.apple.pkpass, list→200 (serial present), unregister→200. Only the real APNs push DELIVERY is unproven until a device registers (part 3); the push code + cert auth are proven.
- **DEPLOYED 2026-07-12**: all current Edge Functions, including every claim/redeem lifecycle function that bundles `wallet-pass-sync.ts`, were redeployed to production. Hosted inventory now exactly matches the 73 local functions.

### DEPLOYED + LIVE-VERIFIED 2026-07-11 (Google)

Google issuer `3388000000023157747` (demo mode — passes work but can't be published until business profile approved). SA `twofer-wallet@twofer-b64b2.iam.gserviceaccount.com` authorized on the issuer.
- Secrets set (prod): `NATIVE_WALLET_PASS_ENABLED=true`, `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON` (base64), `WALLET_PASS_LOGO_URL`.
- Generic class `3388000000023157747.twofer-card` created (`scripts/wallet-google-class-setup.mjs`).
- All 7 functions deployed to prod (`kvodhiqhdqnptqovovia`): wallet-pass-issue + claim-deal, redeem-token, complete-visual-redeem, release-claim, finalize-stale-redeems, staff-redemption.
- **Live end-to-end verified**: signed in as smoke shopper → `wallet-pass-issue` returned HTTP 200 + real `https://pay.google.com/gp/v/save/…` link; the Google object was fetched back via SA (HTTP 200) with correct id/classId, `state: active`, `hexBackgroundColor #11181c`, `cardTitle "Twofer"`, logo set, and `header: "No active deal"` / no barcode (correct — that test user had no active claim). Test artifact: a `wallet_passes` row + Google object exist for smoke user `cd5863d6-…` (harmless).

**Remaining Google steps:** complete the Google Wallet Business Profile and request publishing access for the existing issuer/class, then run full Android device QA. Until Google approves publishing access, only issuer admins/developers and configured test accounts can add passes and passes remain marked `[TEST ONLY]`.

### Pre-deploy verification done 2026-07-11 (no prod credentials needed)

- **Google Wallet JSON schema audited against the live API reference** — every field the builder emits is valid: `genericObject` top-level (`id, classId, state, cardTitle, subheader, header, logo, hexBackgroundColor, textModulesData, linksModuleData, barcode, validTimeInterval`); `cardTitle`+`header` required and always set; `cardTitle/header/subheader` are LocalizedString (`{defaultValue:{language,value}}`) ✓; `barcode` = `{type:"QR_CODE",value,alternateText}` (QR_CODE is the correct BarcodeType enum) ✓; `logo` = `{sourceUri:{uri},contentDescription:LocalizedString}` ✓; `validTimeInterval.end` = DateTime `{date:<ISO8601>}` ✓; `state:"ACTIVE"` valid; a minimal `{id}` `genericClass` insert is valid (matches `scripts/wallet-google-class-setup.mjs`). No schema-shaped deploy failures expected.
- **RS256 JWT signing proven** — the exact `importRs256Key`/`signRs256Jwt` logic from `wallet-pass-sync.ts` was run against a throwaway RSA-2048 keypair (PKCS#8 PEM round-tripped through service-account JSON): both the OAuth assertion and the Save-to-Wallet JWT sign, verify against the public key, and a tampered payload is rejected. WebCrypto is spec-identical on Deno and Node, so the hosted path will behave the same. The only prod unknown left is Google-side account state (issuer approval / SA linkage), not our code.
- `supabase/functions/_shared/wallet-pass-content.ts` — pure content logic (states × locales, sc/ scheme build+parse, Google object JSON), vitest-covered in `wallet-pass-content.test.ts`.
- `supabase/functions/_shared/wallet-pass-sync.ts` — Google REST + RS256 JWT signing + `syncWalletPassForUser` (never throws, kill-switch-gated, logs status codes only).
- `supabase/functions/wallet-pass-issue/` — Google branch live, Apple branch returns 501 pending the Phase 3 spike. Registered in config.toml.
- `redeem-token` + `staff-redemption` recognize `twofer://redeem/sc/<CODE>` server-side; existing merchant/staff builds need no update.
- Sync wired into claim-deal, redeem-token, complete-visual-redeem, release-claim, finalize-stale-redeems (only when state changed), staff-redemption (confirm only, customer's pass).
- Client: `components/add-to-wallet-button.tsx` (flag + Android + not-yet-added gated) surfaced in the QR modal and the wallet active card; `lib/wallet-pass-functions.ts`; walletPass i18n keys ×3; flag rows in eas.json (all `false`).
- Regression lock: `supabase/functions/_shared/wallet-pass-source.test.ts`.

Corrections discovered while building:
1. **Google dropped location-triggered wallet notifications (2023)** — lock-screen geo relevance is **Apple-only**; Google passes get `validTimeInterval` time relevance. §4.2 adjusted.
2. **`lib/functions.ts` is under the AI poster core lock** — the client invoke helper lives in `lib/wallet-pass-functions.ts` instead so the lock file is untouched.
3. The "Redeemed 🎉" state auto-reverts to "No active deal" after **24 h** (`WALLET_PASS_REDEEMED_FRESH_HOURS`) so a weeks-old redemption never lingers on the card.
4. Interim Add-to-Wallet button is styled text, clearly TODO-marked: the **official Google badge artwork** must replace it before the flag ships on a store build (Dan to approve the asset download).

Remaining before Android QA: Phase 0 accounts (Google issuer + SA), Dan-approved: migration apply (+ RLS smoke), `wallet-pass-issue` + 6 touched fn deploys, secrets (`NATIVE_WALLET_PASS_ENABLED`, `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON`, optional `WALLET_PASS_LOGO_URL`), one run of `scripts/wallet-google-class-setup.mjs`, dev-APK rebuild with the flag on.

---

## 1. What we're building, in one paragraph

Every customer gets **one "Twofer Card"** they can add to Apple Wallet or Google Wallet. The card always shows their **current active deal** — deal title, business name, redeem-by time, and the QR code the merchant scans — and updates itself automatically: claim a deal → card shows it; merchant scans → card flips to "Redeemed 🎉"; deal expires or is released → card goes back to "No active deal — open Twofer." Because Twofer already enforces **one active claim app-wide**, a single always-current card is the natural fit — the card *is* your claim.

The whole feature sits behind a flag Dan can turn on or off.

---

## 2. The key architecture decision (read this first)

### The problem
Since the `qr_token_hash` hardening, the server **does not store the plaintext QR token** — `claim-deal` returns it to the phone once and stores only a SHA-256 hash (`supabase/functions/claim-deal/index.ts:733-734`). But Apple Wallet's auto-update protocol requires the **server** to regenerate the full pass on its own (the phone fetches the latest pass in the background after a push). If the pass barcode carried the token, the server couldn't rebuild it without storing the token again — undoing a deliberate security decision.

### The solution: the pass barcode encodes the short code, not the token
The 6-character short code (`ABC123`) **is already stored plaintext** in `deal_claims.short_code` and **is already an accepted redemption credential** — staff type it manually today, and `redeem-token` looks claims up by it (`supabase/functions/redeem-token/index.ts:279-293`). So the pass QR encodes a new URI form:

```
twofer://redeem/sc/<SHORT_CODE>     e.g.  twofer://redeem/sc/ABC123
```

- The merchant scan screen (`app/(tabs)/redeem.tsx:199-209`) forwards the raw scanned string as `token` — **no merchant app change needed, old builds keep working**.
- One small server-side edit to `redeem-token` (and `staff-redemption` if it parses scans itself — verify during build): recognize the `sc/` form and route it to the existing short-code lookup.
- Security is equivalent to today's manual short-code entry: same 32-char alphabet, same brute-force lockout (10 fails / 5 min / business+IP), same expiry rules. No new plaintext secrets stored anywhere.
- The server can now rebuild the entire pass **from the database alone**, any time — which is exactly what Apple's update protocol and Google's object PATCH need.
- Bonus: `twofer://redeem/sc/ABC123` is a far shorter QR payload than a UUID token URI → bigger QR modules → scans faster at the counter, especially from a phone screen showing a wallet pass.

**Dan sign-off needed on this decision** (it's the foundation everything else stands on). Fallback if rejected: store an encrypted copy of the token per pass and purge on claim end — workable but strictly worse.

---

## 3. The feature flag (two knobs, each with a clear job)

| Knob | Where | What it controls | How fast to flip |
|---|---|---|---|
| `EXPO_PUBLIC_ENABLE_NATIVE_WALLET_PASS` | `eas.json` profiles + `.env.development.local`, read via new `isNativeWalletPassEnabled()` in `lib/runtime-env.ts` (same pattern as `isShareDealEnabled()`) | Whether the "Add to Wallet" buttons exist in the app at all | Needs an app rebuild |
| `NATIVE_WALLET_PASS_ENABLED` | Supabase edge-function secret | Whether the server issues passes and syncs updates. Off → issue endpoint returns a clean `feature_disabled` error, lifecycle sync silently no-ops | **Instant** — this is Dan's day-to-day kill switch |

Both must be `true` for the feature to work. Ship with both **off**; flip on for QA; flip server knob off any time without a rebuild. Add both to `getPublicEnvSnapshot()` (client one) for the debug panel.

Behavior when the kill switch goes off with passes already in people's wallets: passes freeze at their last state. A frozen pass showing an old claim's QR just fails at the scanner with the normal "expired/already redeemed" message — safe, no cleanup required.

---

## 4. The experience (UX spec)

### 4.1 Where "Add to Wallet" appears — exactly two places, minimal copy

1. **The claim moment (highest intent).** Right after a successful claim, inside the QR modal (`components/qr-modal.tsx`), below the short-code box: the official badge button. The user just committed to going somewhere — this is when "put it on my lock screen" makes sense.
2. **Wallet tab, active-claim card** (`app/(tabs)/wallet.tsx`): a slim badge row under the "Scan QR at counter" block. Once the pass is added (tracked locally per platform), both surfaces collapse to nothing — no nagging.

Use the **official badge artwork only** — Apple's "Add to Apple Wallet" and Google's "Add to Google Wallet" badges, in the localized variants both companies publish for **en/es/ko**. This is not just polish: both platforms' brand guidelines require it, and Google's Wallet API production approval reviews it. No custom-drawn buttons.

Platform rules: Apple badge only on iOS, Google badge only on Android. Never both.

### 4.2 The card itself

One design, three states. Brand: **background `#11181C`** (the dark used in the app's toasts), **white text**, **labels in Twofer orange `#FF9F1C`**. Logo: **penguin + Twofer wordmark**.

**Assets to produce** (one-time task, from existing art — `assets/images/penguin-master-transparent-1024.png`, `twofer-mark-512.png`, `twofer-penguin.svg`):
- Apple `icon.png` 29pt @1x/2x/3x — penguin mark (also shows on lock-screen notifications for the pass)
- Apple `logo.png` max 160×50pt @1x/2x/3x — penguin + "Twofer" wordmark, white, horizontal
- Apple `thumbnail.png` (square, right side of pass) — penguin on orange
- Google program logo — penguin centered in a 660×660 circle-safe canvas
- All flat brand art. **No offer text, QR codes, or deal data baked into image pixels** (existing AI/offer rule; pass fields are text, which is exactly right).

**State A — Active deal** (Apple `generic` pass style / Google Generic object):

```
┌─────────────────────────────────┐
│ 🐧 Twofer                       │   logo row
│                                 │
│ DEAL                    [🐧]    │   labelColor orange
│ Buy one latte, get one free     │   primary field, deal title
│                                 │
│ AT                REDEEM BY     │
│ Maya's Café       Today 2:00 PM │   secondary fields
│                                 │
│         ▓▓▓▓▓▓▓▓▓▓▓             │
│         ▓ QR CODE ▓             │   twofer://redeem/sc/ABC123
│         ▓▓▓▓▓▓▓▓▓▓▓             │
│           ABC 123               │   barcode altText = short code
└─────────────────────────────────┘
```

- **Barcode altText = the formatted short code.** If the scanner fails, staff read the code right off the pass and type it — the fallback is built into the pass itself.
- **`relevantDate` = redeem-by time** and **`locations` = the deal's business lat/long** (already on the claim's business row). This is the standout detail: **iOS surfaces the pass on the lock screen when the customer walks up to the restaurant.** (Apple-only — Google discontinued location-triggered wallet notifications in 2023; Google passes get time relevance via `validTimeInterval`.) Zero-tap redemption flow: arrive → pass is already on screen → hand phone over.
- **`expirationDate` = redeem-by + grace**, so an untouched pass visually expires on its own even if no update push lands.
- Back of pass (Apple) / details (Google): business address, "How it works" one-liner, support email, and the app link (`associatedStoreIdentifiers` / `appLinkData`) so the pass always routes back to the app.

**State B — Redeemed** (pushed within seconds of the scan):
- Primary: **"Redeemed 🎉"** · Secondary: deal title + "See you next time." No barcode. Auto-replaced the next time they claim.

**State C — No active deal** (after expiry/release, or added before ever claiming):
- Primary: **"No active deal"** · Secondary: **"Open Twofer to grab today's deal."** No barcode. App link prominent. This state is why one-card-per-user beats per-claim passes: the card is never garbage in their wallet — it's a standing re-engagement surface with a penguin on it.

### 4.3 Language
Pass content renders in the customer's app language (en/es/ko) at issue time; the language is stored with the pass and reused for every update. All new UI strings go through `lib/i18n/locales/{en,es,ko}.json` per repo rules.

### 4.4 What the pass never does
- Never shows a QR for a redeemed/expired/released claim.
- Never carries the raw redemption token.
- Never renders offer facts that disagree with the DB — pass content is built server-side from `deal_claims` + `deals` rows only (deal facts stay authoritative).

---

## 5. Architecture

### 5.1 Data model — one migration, `supabase/migrations/<ts>_wallet_passes.sql` (draft only; applying is Dan-gated)

```sql
wallet_passes (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  apple_serial_number text UNIQUE,          -- stable per user, minted at first Apple issue
  apple_auth_token_hash text,              -- SHA-256 of the pass authenticationToken
  google_object_id text UNIQUE,            -- issuerId.twofer-card-<user hash>
  pass_locale text NOT NULL DEFAULT 'en',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)

wallet_pass_registrations (               -- Apple device registrations for update pushes
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number text NOT NULL REFERENCES wallet_passes(apple_serial_number) ... ,
  device_library_identifier text NOT NULL,
  apns_push_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (serial_number, device_library_identifier)
)
```

RLS: **default-deny, service-role only** — every access goes through edge functions. Per the 2026-06-10 lesson, revoke from `PUBLIC` **and** explicitly from `anon`/`authenticated`. After apply: `node scripts/probe-rls-smoke.mjs` immediately (repo rule).

`delete-user-account` / `purge_user_data` must also clear these rows and expire the Google object — add to the purge path.

### 5.2 Edge functions (new + touched)

**New: `wallet-pass-issue`** — authenticated user; body `{ platform: "apple" | "google" }`.
- Checks `NATIVE_WALLET_PASS_ENABLED`. Upserts the user's `wallet_passes` row.
- Google: builds the Generic object (state from DB), inserts/patches it via Wallet REST API, returns a **signed "Save to Google Wallet" JWT link**. Client opens it with `Linking.openURL` — no native SDK needed.
- Apple: builds and **signs the `.pkpass`**, returns it (`application/vnd.apple.pkpass`).

**New: `wallet-pass-webservice`** — Apple's PassKit Web Service REST protocol (the pass's `webServiceURL`), authenticated by the per-pass `authenticationToken` (checked against the stored hash):
- `POST /v1/devices/{dlid}/registrations/{passTypeId}/{serial}` — register device for updates
- `DELETE` same — unregister
- `GET /v1/devices/{dlid}/registrations/{passTypeId}?passesUpdatedSince=` — changed serials
- `GET /v1/passes/{passTypeId}/{serial}` — regenerate + return the latest signed pass **from DB alone** (possible because of the short-code decision)
- `POST /v1/log` — swallow + console.log

**New: `supabase/functions/_shared/wallet-pass.ts`** — the heart:
- `buildPassContent(userId, locale)` — **pure function**: reads nothing, takes claim/deal/business rows, returns one canonical content object (state, fields, barcode value, relevance data) that both the Apple and Google renderers consume. This is the unit-test surface.
- `syncWalletPassForUser(supabaseAdmin, userId)` — fire-and-forget helper: looks up the user's pass row (no row → no-op), rebuilds content, PATCHes the Google object, APNs-pushes every Apple registration (empty push; devices then fetch the latest pass). **Never throws into its caller** — wrapped exactly like the existing owner-push block in `claim-deal`.

**Touched (one added line each, best-effort call after their existing state change):**
| Function | Trigger |
|---|---|
| `claim-deal` | new claim → pass shows it |
| `redeem-token` | counter scan → "Redeemed 🎉" (also gets the `sc/` scheme recognition) |
| `complete-visual-redeem` | visual redeem → "Redeemed 🎉" |
| `release-claim` | released → "No active deal" |
| `finalize-stale-redeems` | stale → correct state |
| `staff-redemption` | verify whether it parses scans itself; if so, same `sc/` recognition |

Claim expiry with no event: covered passively by the pass's own `expirationDate`; the next lifecycle event trues it up.

### 5.3 Client
- `lib/runtime-env.ts`: `isNativeWalletPassEnabled()` + snapshot entry.
- New `components/add-to-wallet-button.tsx`: platform-aware official badge; calls `wallet-pass-issue`; Android opens the save link; iOS presents the pkpass (see risk R4 for the two candidate mechanisms — decided by a Phase 3 spike).
- Wire into `components/qr-modal.tsx` + the active card in `app/(tabs)/wallet.tsx`, both behind the flag.
- "Already added" remembered locally (async storage per platform) so badges disappear after success.
- i18n keys ×3 locales.

### 5.4 Secrets (all Dan-gated, all Supabase secrets, none in the repo — gitleaks/`.easignore` hygiene applies)
- Apple: Pass Type ID **certificate + private key** (base64), Apple **WWDR CA cert**. The same pass cert authenticates APNs pushes for pass updates (topic = the pass type id) — no separate APNs key needed.
- Google: Wallet **issuer ID** + **service-account JSON key** (base64) for JWT signing and object PATCH.
- `NATIVE_WALLET_PASS_ENABLED` kill switch.

---

## 6. What only Dan can do (Phase 0 — starts the clock, blocks nothing else)

1. **Apple Developer portal**: create Pass Type ID `pass.com.unvmex2.twoforone`, issue its certificate. (Agent drafts exact click-by-click steps, including generating the CSR with openssl on this Windows machine — no Mac needed for this part.)
2. **Google Pay & Wallet Console**: sign up as a Wallet API issuer (business approval can take days — start early). Until approved, Google grants a **demo issuer** whose passes carry a "TEST" banner — perfect for S10 QA in the meantime. Create a GCP service account and grant it on the issuer.
3. Approve: the short-code barcode decision (§2), the migration apply, function deploys, `eas.json` flag addition, and the eventual rebuilds.

---

## 7. Build phases

**Phase 1 — Foundations (pure code, no deploys, no gates)**
Flag plumbing; migration file drafted (not applied); `buildPassContent` + full unit tests (all three states × three locales, barcode value, relevance fields — deterministic snapshots); pass image assets produced; i18n keys.
*Gates run: `npm run typecheck`, `npm run lint`, `npm test`, `npm run typecheck:functions`.*

**Phase 2 — Google Wallet MVP (Android-first: Dan's S10, dev APK, demo issuer)**
Generic class setup script (`scripts/wallet-google-class-setup.mjs`, run once, gated); `wallet-pass-issue` Google branch; save-link flow; `syncWalletPassForUser` wired into the six functions; `redeem-token` `sc/` recognition + focused tests (claim/redeem-sensitive → focused gate scripts per repo rules); client badge surfaces. Device QA: add → claim → scan on a second device → watch the card flip states.
*Deploys + migration apply: Dan-gated. RLS smoke after apply.*

**Phase 3 — Apple Wallet (pairs with the next iOS build/TestFlight cycle)**
**Spike first, before committing to the phase:** (a) pkpass PKCS#7 signing on Deno edge (`passkit-generator` via `npm:` specifier, or node-forge directly); (b) APNs HTTP/2 from an edge function; (c) iOS add-pass presentation from Expo. Then: pkpass renderer, `wallet-pass-webservice`, APNs push in sync helper, iOS badge. QA on Dan's iPhone via TestFlight (out of agent scope per repo rules).

**Phase 4 — Hardening + polish**
Account-deletion cleanup; locale-change regeneration; QA matrix (add before ever claiming / claim → add / redeem both methods / release / expire / kill switch off mid-flight); screenshots for Dan's badge-placement approval; runbook doc.

---

## 8. Risks, honestly

| # | Risk | Mitigation |
|---|---|---|
| R1 | **pkpass signing on Deno edge** — PKCS#7 detached signatures are the hardest technical unknown | Phase 3 opens with a spike; Google phase ships value regardless of the outcome |
| R2 | Google issuer approval takes days | Phase 0 starts now; demo issuer covers all QA until then |
| R3 | APNs HTTP/2 from edge functions | Same spike; worst case, pass updates on iOS degrade to "correct on next fetch" instead of instant |
| R4 | iOS add-pass UX from Expo (browser-handoff vs native `PKAddPassesViewController` via config plugin) | Spike decides; browser handoff is the guaranteed-working floor |
| R5 | Stale pass in the wild after kill switch | Fails safe at the scanner (§3); documented |
| R6 | `staff-redemption` scan parsing unknown | Explicit verify item in Phase 2 |

## 9. Non-goals (v1)
Per-claim passes; business-side/loyalty punch cards; NFC/Smart Tap; pass-driven push marketing; iPad (off per locked decisions); any change to claim/redemption business rules — the pass is a **mirror** of existing claim state, never a second source of truth.

---

## 10. Definition of done
Flag on: customer adds the Twofer Card once, and from then on their wallet always tells the truth — current deal with a scannable code that redeems on existing merchant builds, "Redeemed 🎉" seconds after the scan, and a friendly penguin pointing back to the app when there's nothing active. Flag off: feature invisible, zero residue. All repo gates green; RLS probe green after the migration.
