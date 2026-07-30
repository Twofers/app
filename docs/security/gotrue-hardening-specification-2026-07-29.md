# GoTrue (Supabase Auth) hardening specification — 2026-07-29

Builds the Phase 4 `[DEV builds, DAN approves]` item "GoTrue hardening" in
`docs/plans/founder-security-hardening-plan-2026-07-29.md`. Nothing here has been
applied. Every row is a separate founder approval in the Supabase dashboard.

## Do not use `supabase config push`

The `[auth]` block in `supabase/config.toml` is the **local development** shape,
not a mirror of production. It carries `site_url = "http://127.0.0.1:3000"` and
`additional_redirect_urls = ["https://127.0.0.1:3000"]`. Pushing it would
repoint production's redirect allow-list at localhost and break every email link
and OAuth callback, including Google and Apple sign-in.

Make these changes in the dashboard (Authentication → Sign In / Providers →
Rate Limits → Emails), one at a time. The CLI offers no read-only auth-config
command in 2.72.7 (`supabase config` exposes only `push`), so the "current
value" column below has to be read from the dashboard rather than captured
programmatically.

## Change table

Fill "Current (prod)" while making each change, so the result is a dated record.

| # | Setting | Current (prod) | Proposed | Why | Cost | Risk if wrong |
|---|---|---|---|---|---|---|
| 1 | Leaked password protection | off | **stays off** | Pro-only ($25/mo). Explicitly deferred by the bootstrap policy. | $25/mo — not approved | none |
| 2 | Email OTP / recovery link expiry | read it | **1800s (30 min)** | Supabase's own advisor flags the 3600s default. The only consumer is `resetPasswordForEmail` (`app/forgot-password.tsx`); 30 min absorbs slow email delivery while halving the window in which a leaked inbox yields an account. | $0 | Too tight (e.g. 300s) makes recovery links expire before delivery. |
| 3 | Session timebox | unset | **720h (30 days)** | Currently a refresh token is valid forever, so a stolen one is permanent. A timebox is the only thing that expires it without a manual revoke. | $0 | Users are signed out at the boundary and must log in again. |
| 4 | Session inactivity timeout | unset | **720h (30 days)** | Bounds abandoned sessions on lost or resold devices. | $0 | Too short punishes seasonal users of a deals app. |
| 5 | Anonymous sign-ins | expected off | **confirm off** | The app never calls anonymous sign-in; if enabled it is a free unauthenticated row-creation surface. | $0 | none — verification only |
| 6 | Manual account linking | expected off | **confirm off** | Manual linking lets a caller attach an identity to an existing user; the app does not use it. | $0 | none — verification only |
| 7 | CAPTCHA | off | **Cloudflare Turnstile** | The only free control that meaningfully raises the cost of credential stuffing and signup abuse. Turnstile has a free tier and the DNS is already on Cloudflare. | $0 | **Coupled change — see below.** |
| 8 | Password requirements | `""` (length only) | **defer** | Server-side character-class rules would reject passwords the client accepts: `lib/auth-password-recovery.ts` enforces length only (`PASSWORD_MIN_LENGTH = 8`). Raise the client rule first, or users get an opaque server rejection. | $0 | Sign-up and password-reset failures with no useful message. |
| 9 | Minimum password length | 8 | **keep 8** | Matches the client rule. Changing one side without the other reintroduces item 8's mismatch. | $0 | none |
| 10 | SMTP sender | read it | **verify it is the Resend sender with SPF/DKIM passing** | A mismatched sender domain lands auth mail in spam and blocks the Phase 6 DMARC move to `quarantine`/`reject`. | $0 | Auth email delivery failures. |
| 11 | Auth rate limits | Supabase defaults | **no change yet** | Defaults are 30 sign-in/sign-up and 30 token-verification requests per 5 min per IP. With no customer traffic there is no baseline to tighten against, and carrier NAT means a low limit blocks real users. Revisit after launch traffic exists, or after item 7 lands. | $0 | Locking out legitimate users behind shared IPs. |

## Item 7 is not a toggle

Enabling CAPTCHA server-side without client support breaks sign-up, sign-in, and
password reset immediately: GoTrue starts requiring a `captchaToken` that the app
does not send. A repository search found **no** `captchaToken` usage anywhere in
`app/`, `lib/`, or `components/`.

Correct order:

1. `[DEV]` Add Turnstile to the sign-up, sign-in, and forgot-password paths and
   pass `options.captchaToken` on `signUp`, `signInWithPassword`, and
   `resetPasswordForEmail`.
2. `[DEV]` Ship an app build containing it — an installed build without the token
   would break the moment the server setting flips. This is the reason item 7
   cannot ride along with the other rows.
3. `[DAN]` Create the Turnstile site (free), then enable CAPTCHA in the dashboard.

Until step 2 has shipped to the stores, item 7 stays open. Items 1–6 and 9–11
are independent of it and can be done in one sitting.

## Verification after each change

- Items 2–4: sign in on a device, confirm the session survives a restart, then
  request a password reset and confirm the link still works inside the new
  expiry.
- Items 5–6: attempt an anonymous sign-in against the production project and
  confirm it is refused.
- Item 10: send one password reset and confirm SPF/DKIM pass in the received
  headers.
- After any change, re-run `npm run gate:edges` and the sign-in smoke path.

## Open blocker carried from the probe run

`docs/security/database-probe-results-2026-07-29.md` finding 4: the
`unvmex2@hotmail.com` identity currently fails production password grant with
HTTP 500 `Database error querying schema`, while other addresses return the
normal 400. That account is both the chosen security-alert destination and one of
the two active `admin_users` owner rows. Resolve it before or during this batch —
otherwise items 2–4 will be verified against an identity that cannot log in.
