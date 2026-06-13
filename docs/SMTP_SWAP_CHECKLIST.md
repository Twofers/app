# SMTP swap checklist (Supabase dashboard — Dan executes)

Prepared 2026-06-10. Covers spec section 4, item 6: turn on email confirmation with a real
SMTP provider. Everything here is dashboard work in the live Supabase project; no app-code
changes are needed. The app-side pieces (resend button, "confirm your email" login message)
landed in Batch 3 and must be in the build you test with.

## What the app code expects (do not break these)

The redirect URLs are built in `lib/auth-password-recovery.ts` from the **first** scheme in
`app.json` (`twoforone`), so the app sends exactly:

| Flow | Call site | Redirect URL sent |
| --- | --- | --- |
| Signup confirmation | `app/auth-landing.tsx` `signUp` | `twoforone://auth-callback` |
| Resend confirmation | `app/auth-landing.tsx` `auth.resend` | `twoforone://auth-callback` |
| Password reset | `app/forgot-password.tsx` `resetPasswordForEmail` | `twoforone://reset-password` |

Links land on `app/auth-callback.tsx`; `consumeSupabaseAuthDeepLink()` handles both PKCE
(`?code=`) and implicit (`#access_token`) link styles, so the default Supabase email
templates (`{{ .ConfirmationURL }}`) work as-is.

Rate-limit assumptions in code: the resend button has a 60-second client cooldown, and
`lib/auth-error-messages.ts` maps `over_email_send_rate_limit` (and variants) to a friendly
message. The Supabase email rate limit must allow at least ~1 email/min/user.

## Dashboard steps

### A. Custom SMTP (Authentication → Emails → SMTP Settings)
- [ ] Enable Custom SMTP; enter host, port, username, password from the new provider.
- [ ] Sender email: `support@twoferapp.com` (locked public address) or a controlled
      `noreply@twoferapp.com`; sender name "Twofer".
- [ ] Confirm SPF/DKIM/DMARC for `twoferapp.com` are set up at the provider (otherwise
      mail goes to spam and the tests below fail).

### B. Confirm email toggle (Authentication → Sign In / Providers → Email)
- [ ] Confirm email = ON (decided, item 6). Leave "Secure email change" and other
      toggles as they are.

### C. URL Configuration (Authentication → URL Configuration)
- [ ] Additional Redirect URLs contain exactly:
  - `twoforone://auth-callback`
  - `twoforone://reset-password`
  - `twofer://auth-callback` (secondary scheme, cheap insurance)
  - `twofer://reset-password`
  - (optional, dev only) any `exp://...` Metro URL still used for dev-client testing
- [ ] Note the current Site URL before touching anything; leave it as-is unless wrong.

### D. Rate limits (Authentication → Rate Limits)
- [ ] With custom SMTP on, raise the email rate limit from the built-in 2/hour default
      (the cause of the TestFlight breakage). ~30/hour is plenty for the pilot.

### E. Templates (Authentication → Emails → Templates)
- [ ] Check "Confirm signup" and "Reset password" still use `{{ .ConfirmationURL }}`
      and don't hardcode a URL. No customization required.

## Post-swap test sequence (on a phone with a Batch 3+ build)

1. **Fresh signup** with a throwaway address (`dan+smtp1@...`) → in-app "check your email"
   state, email arrives from the new sender within ~1 min. Check spam.
2. **Resend**: without opening the email, tap Resend confirmation → "sent" notice, 60s
   countdown, second email arrives. Proves `auth.resend` works through the new SMTP.
3. **Rate-limit sanity**: after the cooldown, resend once more → success, or the friendly
   rate-limit message (never a raw error).
4. **Link tap on-device**: open the confirmation email on the phone → link opens the app at
   `auth-callback`, signed in. A browser error page means step C is wrong.
5. **Unconfirmed login message**: with a second unconfirmed throwaway, try logging in →
   "confirm your email" message, not "wrong email or password".
6. **Password reset**: Forgot password → email → link opens the in-app reset-password
   screen → new password works at login.

## Docs to update after the swap

- `twofer-developer-handoff-spec.md` section 4 item 6 — "Dan configures Supabase later"
  becomes done.
- `twofer-developer-handoff-spec.md` "Known broken item" paragraph (email confirmation
  broken for TestFlight users because default SMTP is test-only) — becomes false; rewrite
  or remove.
- `CLAUDE.md` / `AGENTS.md` section-4 item 6 — same "at a later date" wording.
- `docs/DEMO_SEED.md` mentions manual email confirmation for the demo account — moot once
  demo deletion (item 2) lands; leave unless touching that file anyway.
