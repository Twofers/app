# Founder action list — everything left, in order

All 31 open items from `docs/plans/founder-security-hardening-plan-2026-07-29.md`,
ordered by risk removed per minute spent. Terminal commands are given where a
terminal can do the job; the rest say plainly that they need a browser, because
a fake command is worse than none.

Reference identifiers, so nothing below needs looking up:

| Thing | Value |
| --- | --- |
| Supabase production ref | `kvodhiqhdqnptqovovia` |
| App package / bundle | `com.unvmex2.twoforone` |
| App Store ID | `6765769303` |
| Vercel project | `v0-twofer-landing-page` |
| GitHub repo | `Twofers/app` (**public**) |
| Backup recipient (age) | `age14h87sed9kx36vk2ufpyh6jr9uwflqvqnzr37f4u47pafncvfryxstt9qqz` |
| Google Cloud project | `twofer-b64b2` |

---

## Tier 1 — do these first (about 20 minutes, removes the worst outcomes)

### 1.1 Verify the USB copy of the backup key ⚠️ highest value in the list

If both copies of this key are lost, every backup in B2 survives Object Lock
perfectly and is **permanently unreadable**. No provider, no support ticket, no
re-issue. `age` is not installed on this machine — fix that first, since
discovering it during a real recovery would be its own disaster.

```bash
winget install FiloSottile.age
```

Then, with the USB drive mounted (replace `E:`):

```bash
age-keygen -y E:/twofer-backup-age-identity.txt
```

Must print exactly:

```
age14h87sed9kx36vk2ufpyh6jr9uwflqvqnzr37f4u47pafncvfryxstt9qqz
```

Anything else means the copy does not decrypt your backups. While you are there,
make a third copy somewhere that is not flash memory — a password-manager secure
note or paper in a safe. Unpowered flash degrades and this key has no expiry.

### 1.2 Turn on Dependabot alerts and security updates

Nothing is currently watching your dependency tree for published CVEs. Free on a
public repo. **Browser only** — I tried the API and the permission classifier
blocked it, correctly.

<https://github.com/Twofers/app/settings/security_analysis> → enable **Dependabot
alerts**, then **Dependabot security updates**.

Verify afterwards:

```bash
gh api repos/Twofers/app --jq '.security_and_analysis.dependabot_security_updates.status'
```

Expect `enabled`.

### 1.3 Protect `main`

`main` currently accepts force-pushes and deletion from anyone with write access.
**Browser** (the API needs a token scope you should not widen just for this):

<https://github.com/Twofers/app/settings/branches> → Add branch ruleset → target
`main` → block force pushes, block deletions, require a pull request, require
status checks `check` and `secret-scan`.

Verify:

```bash
gh api repos/Twofers/app/branches/main/protection --jq '.required_status_checks.contexts'
```

Anything other than `Branch not protected` is progress.

### 1.4 Decide repo visibility

Currently **public** — full backend, admin console design, and migration history
are readable by anyone. Making it private does **not** scrub history, and
gitleaks CI already guards new commits, so this is a judgement call about
exposing design rather than an emergency.

<https://github.com/Twofers/app/settings> → bottom → Change visibility.

---

## Tier 2 — provider account hardening (one sitting, ~45 minutes, browser only)

Nine accounts. None of this can be scripted; MFA enrollment is deliberately
interactive. The ordering is by blast radius — the first two can end the
business, the rest cost money or reputation.

| # | Account | What to do | Why this order |
| --- | --- | --- | --- |
| 2.1 | **Founder Google account** | Passkey or TOTP, **remove SMS fallback** | Root of trust for Play, Google Cloud, and most recovery paths. SIM-swap defeats SMS |
| 2.2 | **Expo / EAS** | MFA; audit tokens and sessions | Holds the Android signing keystore — treat as a signing authority |
| 2.3 | **Stripe** | MFA; recovery codes offline; alert on payout-bank change; rotate webhook signing secret; review Radar | Direct money movement |
| 2.4 | **Supabase** | Org members + MFA; store the TOTP seed offline — Supabase issues **no recovery codes** | Losing this locks you out of the database entirely |
| 2.5 | **Google Cloud** | Restrict API key `AIzaSyA29R…KDNU` (project `twofer-b64b2`) | See 2.5a below — this one has a concrete, cheap fix |
| 2.6 | **Apple Developer** | MFA, recovery, membership audit | App Store app `6765769303` |
| 2.7 | **Google Play Console** | MFA, membership audit; secure the Play service-account JSON on this machine | Also holds your app-signing key |
| 2.8 | **OpenAI + Gemini** | Provider-side hard spend caps and billing alerts | In-app quotas are not a provider cap — a leaked key bills you directly |
| 2.9 | **Resend** | MFA; key rotation procedure | A stolen key sends phishing *as* twoferapp.com |
| 2.10 | **Vercel / Namecheap / Cloudflare** | MFA; token audit; recovery address that is **not** @twoferapp.com | A recovery address on your own domain is a circular dependency |

### 2.5a The Google API key — specifics

`android/app/google-services.json` is tracked in the public repo and carries key
`AIzaSyA29R…KDNU`. That is expected — it ships inside the APK anyway — but it is
safe **only if restricted**, and an unrestricted key of this shape is the
realistic billing-abuse path here.

<https://console.cloud.google.com/apis/credentials?project=twofer-b64b2>

- **Application restrictions** → Android apps → package `com.unvmex2.twoforone`
  with the **Play App Signing** SHA-1 (Play Console → Setup → App integrity).
  Not the upload key's `96:46:B6:75:33:5E:61:DC:1D:AF:98:DF:FE:5F:40:9B:2C:EC:49:76`.
- **API restrictions** → Restrict key → only Places and Maps SDK for Android.

---

## Tier 3 — the secrets vault (~15 minutes, not the afternoon it looks like)

The plan says "~60 secrets re-minted". The real number is **four values**, plus
one that is missing from the inventory entirely. Full reasoning in
`secrets-vault-scope-2026-07-31.md`.

Put these four into the same offline store as the age key:

| Name | Why it cannot be re-issued |
| --- | --- |
| `ANON_ABUSE_IP_HASH_SECRET` | HMAC pepper — a new value silently stops matching stored IP hashes |
| `QR_SCAN_IP_HASH_SECRET` | Same, for QR scan dedup |
| `APPLE_PASS_KEY_PEM_B64` | Signed passes already sitting in customers' wallets |
| `APPLE_PASS_CERT_PEM_B64` | The matching certificate |

Read the current values from Supabase (this prints secret values — do it in a
terminal you are not sharing):

```bash
npx supabase secrets list --project-ref kvodhiqhdqnptqovovia
```

Everything else in the 103-name inventory is either re-issuable from a provider
(27 — that is Tier 2, and vaulting a value that rotation invalidates buys
nothing), plain config recoverable from the repo (66), or throwaway test logins
(6).

**Also do this:** add the age private identity to
`docs/security/secrets-inventory.md` as a row whose recovery column says plainly
that it cannot be re-issued. It is absent today because the inventory is
generated from names referenced in code, and that key is deliberately never
referenced — so the generator cannot see the single most irreplaceable value you
own.

---

## Tier 4 — the restore drill (the biggest remaining unknown)

**A backup is not valid until it has been restored, and yours never has.** RPO is
under 24 hours and proven. RTO is *unmeasured*. This is the item that converts a
guess into a number.

It needs a disposable Supabase project, which costs nothing on the free tier.

**Step 1 — create it** (browser): <https://supabase.com/dashboard> → New project,
name it `twofer-restore-drill`. Throwaway; delete it afterwards.

**Step 2 — set the drill secrets** (terminal, once you have the new project's
URL, anon key, service-role key, and ref):

```bash
gh secret set RESTORE_SUPABASE_URL
gh secret set RESTORE_SUPABASE_ANON_KEY
gh secret set RESTORE_SUPABASE_SERVICE_ROLE_KEY
gh secret set DISPOSABLE_SUPABASE_PROJECT_REF
gh secret set PRODUCTION_SUPABASE_PROJECT_REF
gh secret set RESTORE_TEST_EMAIL
gh secret set RESTORE_TEST_PASSWORD
gh secret set ALLOW_DISPOSABLE_RESTORE
```

Each prompts for the value without echoing it. Confirm the names landed:

```bash
gh secret list
```

**Step 3 — run the drill** following `docs/security/backup-and-restore-runbook.md`
§"Quarterly restore drill". Tell me when the project exists and I will drive the
restore and verification end to end and record the measured RTO.

**Also in this tier:** `BACKUP_DB_ROOT_CERT_PEM` is still unset, so every backup
run warns that the database connection is encrypted but the server certificate is
unverified. And the backup heartbeat is unconfigured — a silently failing nightly
run would currently go unnoticed:

```bash
gh secret set BACKUP_SUCCESS_HEARTBEAT_URL
gh secret set BACKUP_FAILURE_WEBHOOK_URL
```

---

## Tier 5 — this machine (~15 minutes)

### 5.1 BitLocker

I tried both read paths and both were denied without elevation, which is
expected. **Open PowerShell as Administrator**, then:

```powershell
manage-bde -status C:
```

Require `Protection Status: Protection On`. If it is off, enable it and store the
recovery key in your password manager, not in your Microsoft account alone.

### 5.2 Android keystores — mostly resolved already

Five keystore files, but only **two distinct keys** — the four
`@unvmex2__twoforone*.jks` copies are byte-identical, and none has ever been
committed. Details in `android-signing-key-identification-2026-07-31.md`.

One command each identifies the live upload key (both prompt for the store
password):

```bash
"/c/Users/unvme/.gradle/jdks/eclipse_adoptium-17-amd64-windows.2/bin/keytool" -list -v -keystore "@unvmex2__twoforone.jks" | grep -A1 "SHA256:"
```

```bash
"/c/Users/unvme/.gradle/jdks/eclipse_adoptium-17-amd64-windows.2/bin/keytool" -list -v -keystore "$HOME/keys/twofer-upload-key.keystore" | grep -A1 "SHA256:"
```

The one printing `9E:05:0E:94:E8:F7:A7:9A:…:04:83:2C:93` is the live upload key.
Vault that file **with its store password, key alias, and key password** — a
keystore without its passwords is not a backup. Then delete the redundant `OLD_*`
duplicates.

Reassuring context: Play App Signing holds the distribution key, so losing the
upload key is a support ticket, not the end of shipping updates.

### 5.3 Local secret files and password manager

```bash
ls -la .env* android/app/google-services.json ~/.config/gh/hosts.yml 2>/dev/null
```

Move what you can into the password manager, and turn off browser password
storage for every founder and provider account.

---

## Tier 6 — Supabase control plane (each one a separate approval)

| # | Item | How |
| --- | --- | --- |
| 6.1 | Restrict direct Postgres/pooler access to a trusted IP | Dashboard → Database → Network restrictions. Note the backup runner needs access — GitHub-hosted runners have no static IP, so this needs a decision, not just a toggle |
| 6.2 | Rotate the DB password | Only after 6.1 is verified. The current one appeared in a session transcript |
| 6.3 | Revoke old Supabase personal access tokens | Dashboard → Account → Access tokens |
| 6.4 | Close the Security Advisor gate | 0 errors, 43 warnings remain; each is dispositioned in `supabase-security-advisor-warning-triage-2026-07-29.md`. Includes one product decision on `validate_business_invite` |
| 6.5 | Diagnose `unvmex2@hotmail.com` | Cannot get a production token — HTTP 500 `Database error querying schema`, while other addresses return a normal 400. It is your security-alert destination *and* one of two `admin_users` owners |
| 6.6 | Decide `demo@demo.com`'s fate | Reviewer account with known credentials in production |

---

## Tier 7 — remaining infrastructure

| # | Item | Notes |
| --- | --- | --- |
| 7.1 | Vercel manual production promotion + alerts | <https://vercel.com/dashboard> → project `v0-twofer-landing-page` → Settings. Note: merging to `main` already does **not** auto-deploy — verified 2026-07-31 — so this is about making that intentional rather than accidental |
| 7.2 | Replace the broad classic GitHub token | Fine-grained or hardware-backed. **Do not** widen it in response to the `workflow` scope error seen twice today — that error means a stale branch, not a missing scope |
| 7.3 | `admin.twoferapp.com` behind Cloudflare Access | Founder identity only |
| 7.4 | DNS/email | Registrar auto-renew + backup payment; DNSSEC via Cloudflare then publish the DS record; DMARC `p=none` → `quarantine` → `reject` only after SPF/DKIM verified |
| 7.5 | EAS credential export | `eas credentials -p android` — export keystore and iOS certs into the vault |
| 7.6 | Takeover recovery exercise | `takeover-recovery-exercise-2026-07-29.md` is an executable worksheet. Needs Tiers 1–4 done first |
| 7.7 | `api.twoferapp.com` portability | **Deferred on cost**, not pending. Revisit only if the zero-cost policy changes |

---

## Quick verification sweep

After Tiers 1–2, this shows what actually changed:

```bash
gh api repos/Twofers/app --jq '{visibility, security: .security_and_analysis}' && gh api repos/Twofers/app/branches/main/protection --jq '.required_status_checks.contexts' 2>&1 | tail -1 && gh secret list | wc -l
```
