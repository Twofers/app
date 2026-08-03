# Wallet QR timed reveal + staff double-tap banner — 2026-08-02

**Goal:** After a deal is claimed, the QR code and 6-digit code are hidden everywhere
until the customer starts the redemption flow ("Use deal" → slide to confirm → timed
pass). While the pass's 30-second window is running, a prominent staff-directed banner
tells the employee to double-tap the QR to mark the deal used.

**Decisions (Dan, 2026-08-02):**
- Post-claim: confirmation only ("It's in your wallet — open it at the counter"), no QR popup.
- Wallet card: remove the "Show QR at the counter" tile entirely; "Use deal" is the only reveal path.
- Staff hint: bold high-contrast banner on the pass, visible the whole 30s window.

**Already exists (do not rebuild):** the double-tap manual redeem gesture + confirm
dialog (`hooks/use-manual-qr-redeem.ts`) works on both QR surfaces. The pass's 30s
countdown (`components/wallet-visual-pass.tsx`, `PASS_VISIBLE_MS`) works. This plan
only changes *where QR/code render* and *how the staff instruction reads*.

---

## Status: CODE COMPLETE — uncommitted, not yet device-tested

Verified 2026-08-02: `npx tsc --noEmit` clean, `npx expo lint` clean (0 errors 0 warnings),
`npx vitest run` 2235/2236 (the 1 failure is the pre-existing AI-poster-lock hash drift on
`app/create/ai.tsx`, a file this work never touched — unmodified vs HEAD), and
`node scripts/check-i18n-keys.mjs` PASS.

Remaining: step 8's manual S10 device pass, and a commit. NOTE: the working tree is shared
with the merchant-activation work, and `lib/i18n/locales/{en,es,ko}.json` carry edits from
BOTH efforts — split the commit by hunk.

## Steps

### 1. Extract the claim success toast out of QrModal
- [x] New `components/claim-success-toast.tsx`: lift the confetti + toast block from
      `components/qr-modal.tsx` (ConfettiParticle, toast state/animation, ~lines 40–328)
      into a standalone overlay component. Props: `nonce`, `variant: "claimed" | "redeemed"`,
      `subtitle` (string). Same visuals, no modal backdrop.
- This preserves the claim celebration after the QR modal stops appearing.

### 2. Feed post-claim — `app/(tabs)/index.tsx`
- [x] In the claim-success path (~lines 768–787): stop setting `qrToken/qrExpires/qrShortCode`
      and stop `setQrVisible(true)`. Keep analytics, `loadUserClaims`, and the expiry reminder.
- [x] Render `ClaimSuccessToast` at screen level with subtitle = new key
      `dealsBrowse.claimedInWallet`.
- [x] Card status line: replace `dealsBrowse.statusClaimedShowQr` ("Claimed. Show your QR.")
      with the new in-wallet copy.
- [x] Remove the `QrModal` usage (~line 1962), its qr* state, `hideClaimQrModal`, and the
      `useClaimRedeemedWatch` that was scoped to the open QR modal.

### 3. Deal page post-claim — `app/deal/[id].tsx`
- [x] Claim success (~line 619): replace `openClaimQr(out, true)` with `ClaimSuccessToast`.
- [x] The `active_claimed` CTA (~line 867) currently opens the QR (`viewQr`). Change it to
      route to the wallet tab ("In your wallet — open it") instead of revealing the QR.
- [x] Remove `openClaimQr`, `viewQr`, qr* state, the QR-scoped `useClaimRedeemedWatch`
      (~lines 406–420), and the `QrModal` usage (~line 1233).

### 4. Wallet card — `app/(tabs)/wallet.tsx`
- [x] Delete the always-visible "Show QR at the counter" tile (NativePressable, ~lines 906–958),
      including the visible `shortLabel` code preview.
- [x] Delete now-orphaned plumbing: `openVerifyForClaim`, `refreshQr`, all `qr*` state
      (~lines 158–165), the QR-modal `useClaimRedeemedWatch` (~lines 338–357), the
      `QrModal` usage (~lines 1217–1235), and the unreachable `tokenDead` "Get new QR"
      block (~lines 1023–1032) + `refreshClaimFromRow` (active bucket already excludes
      token-dead rows, so this block can never render).
- [x] Keep unchanged: countdown header, "Use deal" slide flow, AddToWalletButton,
      share, release, directions, the pass deep link (`?pass=1` → opens pass directly —
      that IS redemption time), and the pass-scoped `useClaimRedeemedWatch`.

### 5. Staff banner on the pass — `components/wallet-visual-pass.tsx`
- [x] While `qrWindowActive`, render a bold high-contrast banner adjacent to the QR
      (white/amber card on the dark green), new key `consumerWallet.passStaffDoubleTap`:
      EN "Staff: double-tap the QR to mark this deal used".
- [x] Replace the current small hint usage (`manualRedeem.hintLabel`) on this surface with
      the banner; keep `manualRedeemBusy` ("Marking used…") and the error text (error must
      still outlive the 30s window — preserve that fix, see comment at ~line 251).
- [x] Update the a11y label in `use-manual-qr-redeem.ts` only if copy changes there;
      the gesture, confirm dialog, and no-time-gate design (Dan, 2026-07-25) stay as-is.

### 6. Delete `components/qr-modal.tsx`
- [x] After steps 2–4 it has zero consumers — delete it. Leave its now-unused locale keys
      in place (the i18n gate checks used-keys-exist, not the reverse); prune later.

### 7. i18n — `lib/i18n/locales/{en,es,ko}.json`
- [x] `dealsBrowse.claimedInWallet` — EN "Saved to your wallet. Open it at the counter." /
      ES "Guardado en tu billetera. Ábrela en el mostrador." / KO "지갑에 저장되었습니다. 카운터에서 열어 주세요."
- [x] `consumerWallet.passStaffDoubleTap` — EN "Staff: double-tap the QR to mark this deal used" /
      ES "Personal: toca el QR dos veces para marcar la oferta como usada" /
      KO "직원용: QR을 두 번 탭하면 사용 처리됩니다"
- [x] Update/replace `dealsBrowse.statusClaimedShowQr` copy in all three locales.
- Keep copy minimal (few-words screens preference).

### 8. Verify
- [x] `npm test` baseline (no existing tests reference the removed pieces — verified by grep).
- [x] `check:i18n-keys` (CI-only gate — run locally per its script).
- [ ] Manual on S10 dev client: claim from feed → toast only, no QR; wallet card has no
      QR/code; Use deal → slide → pass shows QR + staff banner; double-tap → confirm →
      marked used; staff scanner path still works; es/ko spot-check.

## Known limitation (accepted for now)
The native Apple/Google Wallet passes embed the short-code QR in the OS wallet itself
(`supabase/functions/_shared/apple-pass-json.ts` — `PKBarcodeFormatQR`). A customer who
added the pass can always show that barcode from the OS wallet, outside the 30s window.
Gating that would mean stripping the barcode from native passes, which defeats their
scan-at-counter purpose. Out of scope; revisit only if abuse shows up.

## Out of scope
- Merchant scanner screens (`app/(tabs)/redeem.tsx`, `app/redemption-mode.tsx`) — unchanged.
- The 30s window length, double-tap timing, confirm dialog, redemption backend — unchanged.
