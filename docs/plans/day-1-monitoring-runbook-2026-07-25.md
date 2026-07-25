# Day-1 monitoring runbook (Phase E4)

**Context:** Twofer 1.0.1 ships with **no crash-reporting SDK** (decision #4 in the
launch plan — adding a native module days before launch is worse than launching
without). This runbook is the compensating control. Sentry lands in 1.0.2.

**Cadence:** twice a day minimum for the first week — once mid-morning, once
early evening. Each pass is the seven checks below; budget ~15 minutes.

Owner: Dan. Nothing here is agent-executable — every surface is a console Dan
holds credentials for.

---

## The seven checks

### 1. Play Console → Quality → Android vitals
- **Look at:** crash rate, ANR rate, and the "bad behaviour" threshold banner.
- **Good:** crash-free sessions ≥ 99%. Google's bad-behaviour threshold is 1.09%
  user-perceived crash rate; crossing it costs store visibility.
- **Act if:** any single crash signature is >10% of crashes → that is a
  systematic bug, not noise. Pull the stack trace; it is the closest thing to a
  crash SDK we have this release.
- **Note:** vitals lag several hours. An empty dashboard on launch morning means
  "no data yet", not "no crashes".

### 2. App Store Connect → Analytics + TestFlight/Xcode Organizer crashes
- **Look at:** crash count, and whether any crash is in a launch path.
- **Reality check:** iOS crash data only arrives from users who opted into
  sharing diagnostics, so treat the count as a floor, not a total.
- **Act if:** any crash appears in the first-launch or sign-in path — that is a
  hotfix, because it blocks every new user.

### 3. Supabase → Edge Functions → Logs (any 5xx)
- **Look at:** 5xx across all 79 functions, newest first.
- **Highest-signal functions this release:** anything auth- or publish-adjacent —
  `submit-business-application`, `get-business-onboarding-context`,
  `publish-offer-version`, `delete-user-account`, `redeem-*`.
- **Act if:** a 5xx repeats. One-offs are usually cold starts; a pattern is a
  bug. Note the function version so you can tell a regression from a
  pre-existing issue.

### 4. Supabase → Authentication → Logs (rate-limit hits)
- **This is the day-1 sleeper.** The auth email rate limit was **30/hour** at
  audit time (plan C2 raises it). Confirmation email is the signup gate, so
  hitting the ceiling silently stalls every new signup until the window rolls.
- **Look for:** `over_email_send_rate_limit`, 429s on signup/recovery.
- **Act if:** you see even one — raise the limit immediately. Users who hit it
  get a "too many requests" message and typically do not come back.
- **Also watch:** Apple/Google `signInWithIdToken` failures. An **audience**
  error means the Supabase Google provider is missing the iOS client ID
  (plan C1) and iOS Google sign-in is broken while Android looks fine.

### 5. Resend → delivery dashboard
- **Look at:** delivery rate, bounces, complaints, suppressions.
- **Act if:** bounce rate climbs above ~5%, or any domain-level suppression
  appears — that threatens deliverability of every confirmation email.
- **Free-tier ceiling is 100 emails/day.** If the plan was not upgraded (C2),
  signups stall mid-afternoon on a good launch day.

### 6. Stripe → Events / Webhooks
- **Look at:** the prod endpoint's recent deliveries and any failed retries.
- **Act if:** delivery failures accumulate — subscription state silently
  desyncs from Stripe.
- **Specifically confirm** `charge.dispute.created` is firing to the handler
  (plan C3). It shipped later than the endpoint was configured, so if it was
  never subscribed, chargeback auto-suspension never runs and you will not get
  an error — just silence.

### 7. Admin AI-spend panel + support inbox
- **AI spend:** confirm the daily cost curve is plausible and no single business
  is running away with generations. Cap is 30/business/month (`AI_MONTHLY_LIMIT`).
- **OpenAI prepaid balance:** if it empties, generation falls back and costs
  change — check it is still funded.
- **support@twoferapp.com:** the highest-signal channel on day 1. With no crash
  SDK, a user email is often the *first* notice of a broken path. Read every
  message, even the vague ones.

---

## Escalation

| Signal | Severity | Action |
|---|---|---|
| Crash in first-launch or sign-in path | **Stop-the-line** | Halt the Play staged rollout; iOS phased release can be paused in App Store Connect. |
| Auth email rate-limit hits | **Urgent** | Raise the Supabase limit; check the Resend plan. Signups are blocked meanwhile. |
| iOS-only Google sign-in failures (audience error) | **Urgent** | Add the iOS client ID to the Supabase Google provider (C1). Android will look healthy throughout. |
| Repeated 5xx on one function | High | Read logs, decide hotfix vs. revert. Function deploys are not gated by a store review, so this is a fast fix. |
| Stripe webhook delivery failures | High | Replay from the Stripe dashboard once fixed. |
| Bounce rate climbing | Medium | Check DKIM/SPF still valid (docs/SMTP_SWAP_CHECKLIST.md). |

**Rollout levers, both reversible:**
- **Play:** staged rollout 20% → 100%. Halt in Play Console without pulling the
  release.
- **iOS:** phased release ON spreads over 7 days and can be paused. A pulled
  build needs a new review; a paused phased release does not.

Use them. A staged rollout you never pause is just a slower launch.
