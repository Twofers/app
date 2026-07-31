# Android signing key identification — 2026-07-31

Clears steps 1–3 of the Phase 7 local-secret sweep in
`founder-security-operations-runbook.md`, which read:

> 1. Identify the currently active Android keystore by certificate fingerprint.
> 2. Back it up encrypted with its alias/password and Play recovery instructions.
> 3. Verify the backup before retiring redundant `OLD` copies.

The developer half of step 1 is done, and step 3's premise turns out to be
mostly moot. Losing the Android signing key means losing the ability to ship
app updates at all, so the redundancy question was worth answering exactly.

## First: nothing is exposed

All five keystore files on this machine are gitignored and **have never been
committed** — checked against the full history, not just the working tree:

```
git log --all --oneline --name-only -- "*.jks" "*.keystore"   ->  no output
```

| File | Ignored by |
| --- | --- |
| `@unvmex2__twoforone.jks` | `.gitignore:15` |
| `@unvmex2__twoforone_OLD_1.jks` | `.gitignore:15` |
| `@unvmex2__twoforone_OLD_2.jks` | `.gitignore:15` |
| `@unvmex2__twoforone_OLD_manual.jks` | `.gitignore:15` |
| `android/app/debug.keystore` | `.gitignore:47` |

`~/keys/twofer-upload-key.keystore` sits outside the repository entirely.

## There are four copies, but only two distinct keys

The four `@unvmex2__twoforone*.jks` files are **byte-identical** — same size,
same SHA-256. The `OLD_1` / `OLD_2` / `OLD_manual` suffixes describe when they
were copied, not different keys:

| File | Bytes | Modified | SHA-256 (first 16) |
| --- | ---: | --- | --- |
| `@unvmex2__twoforone.jks` | 2,193 | 2026-07-08 | `c5a2cc66d14ea38a` |
| `@unvmex2__twoforone_OLD_1.jks` | 2,193 | 2026-07-06 | `c5a2cc66d14ea38a` |
| `@unvmex2__twoforone_OLD_2.jks` | 2,193 | 2026-07-08 | `c5a2cc66d14ea38a` |
| `@unvmex2__twoforone_OLD_manual.jks` | 2,193 | 2026-07-06 | `c5a2cc66d14ea38a` |
| `~/keys/twofer-upload-key.keystore` | 2,742 | 2026-06-08 | `d7828ce7aad7a363` |

So the real question is not "which of five" but **"which of two"** — `c5a2cc66`
or `d7828ce7`. And deleting any three of the four identical copies destroys
nothing, provided one copy of `c5a2cc66` survives.

## What the shipped app is actually signed with

Read directly off a real build artifact, so this needs no keystore password and
no assumptions. `keytool -printcert -jarfile` reports *"Not a signed jar file"*
because modern APKs use APK Signature Scheme v2+; `apksigner` reads it:

```
apksigner verify --print-certs application-b2991b8a-….apk
  Signer #1 certificate SHA-256 digest:
    9e050e94e8f7a79abfa23cae084cd5e3ec9bbfd69183a071206cac5b04832c93
```

That maps exactly onto the second fingerprint published in the live
`assetlinks.json` for `com.unvmex2.twoforone`:

| Fingerprint | What it is |
| --- | --- |
| `92:65:79:9A:9D:FB:83:05:…:0B:92:C9:C0` | Held by Google — **Play App Signing**. Not on this machine and not recoverable from it |
| `9E:05:0E:94:E8:F7:A7:9A:…:04:83:2C:93` | **The upload key** — matches the built APK byte for byte |

This is what the earlier "2nd fingerprint verified" App Links note was pointing
at, now with the mapping made explicit rather than implied.

The practical consequence is reassuring: because Play App Signing holds the
distribution key, losing the *upload* key is recoverable through Play support
rather than fatal. It is still the key that must be vaulted.

## The one step left, and it needs the store password

Which of the two distinct files carries cert `9E:05:0E:94:…` cannot be
determined without the keystore password, which is founder-held by design. It
is one command per file — `keytool` is already on this machine:

```bash
"/c/Users/unvme/.gradle/jdks/eclipse_adoptium-17-amd64-windows.2/bin/keytool" -list -v -keystore "@unvmex2__twoforone.jks" | grep -A1 "SHA256:"
```

```bash
"/c/Users/unvme/.gradle/jdks/eclipse_adoptium-17-amd64-windows.2/bin/keytool" -list -v -keystore "$HOME/keys/twofer-upload-key.keystore" | grep -A1 "SHA256:"
```

Each prompts for the store password. The one printing
`9E:05:0E:94:E8:F7:A7:9A:BF:A2:3C:AE:08:4C:D5:E3:EC:9B:BF:D6:91:83:A0:71:20:6C:AC:5B:04:83:2C:93`
is the live upload key.

Then:

1. Vault that file **with its store password, key alias, and key password** — a
   keystore without its passwords is not a backup. Note which of the two it was.
2. The other distinct keystore is an obsolete key. Vault one copy anyway before
   deleting anything; keys are cheap to store and impossible to recreate.
3. Delete the redundant `OLD_*` duplicates only after step 1, and only if the
   survivor is the identified one.

## Caveat worth stating

EAS is the authority here, not this machine. `eas.json` sets no
`credentialsSource` and there is no `credentials.json`, so builds use the
remote keystore EAS holds. A local file matching the fingerprint proves the
same key exists locally; it does not prove EAS is using that copy. The
Phase 2 item "Expo/EAS account: audit tokens/sessions; this account holds the
Android signing keystore" is where that gets confirmed, via
`eas credentials -p android`.
