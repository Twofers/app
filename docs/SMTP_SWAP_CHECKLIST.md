# SMTP swap checklist (Supabase dashboard — verified 2026-06-13)

Prepared 2026-06-10 and updated after live dashboard verification on 2026-06-13.
Covers spec section 4, item 6: keep email confirmation on with a real SMTP provider.
The Supabase dashboard setup is complete; the remaining work is inbox delivery QA with a
fresh throwaway address and on-device link testing.

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

## Dashboard state verified 2026-06-13

### A. Custom SMTP (Authentication → Emails → SMTP Settings)
- [x] Custom SMTP is enabled.
- [x] Sender email is `support@twoferapp.com`; sender name is "Twofer".
- [x] SMTP host is `smtp.resend.com`; username is `resend`; password is saved and hidden.
- [x] Minimum interval per user is 30 seconds.
- [x] DNS check: `resend._domainkey.twoferapp.com` DKIM TXT exists; `_dmarc.twoferapp.com`
      exists with `p=none`; `send.twoferapp.com` has SPF `include:amazonses.com` and an
      MX record to `feedback-smtp.us-east-1.amazonses.com`.

### B. Confirm email toggle (Authentication → Sign In / Providers → Email)
- [x] Confirm email = ON (decided, item 6). Leave "Secure email change" and other
      toggles as they are.

### C. URL Configuration (Authentication → URL Configuration)
- [x] Site URL is `https://www.twoferapp.com`.
- [x] Additional Redirect URLs contain exactly:
  - `twoforone://auth-callback`
  - `twoforone://reset-password`
  - `twofer://auth-callback` (secondary scheme, cheap insurance)
  - `twofer://reset-password`

### D. Rate limits (Authentication → Rate Limits)
- [x] Email send rate limit is 30/hour.

### E. Templates (Authentication → Emails → Templates)
- [x] "Confirm sign up" subject is "Confirm your Twofer account".
- [x] "Confirm sign up" body uses `{{ .ConfirmationURL }}` and does not hardcode a URL.

## 2026-06-13 troubleshooting note

- Supabase showed `unvmex2@hotmail.com` as an existing confirmed user created on
  2026-03-26, so a fresh signup attempt with that address should not be expected to
  receive a new confirmation email.
- Supabase auth logs showed `/signup` and `/resend` requests completed during the test.
- A direct `supabase.auth.resend({ type: "signup" })` probe for that address returned
  success. If no email appears, check junk/spam and the Resend event log for delivered,
  bounced, suppressed, or complained events.

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

## Docs updated after verification

- `twofer-developer-handoff-spec.md` section 4 item 6 and section 17 now record the
  verified SMTP/dashboard state.
- `CLAUDE.md` / `AGENTS.md` section-4 item 6 now record the verified SMTP/dashboard state.
- `docs/TWOFER_GAP_AUDIT.md` now records the verified SMTP/dashboard state.
