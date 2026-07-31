# Secrets vault: what actually has to go in it — 2026-07-31

The Phase 1 item reads *"encrypted offline copy of secret values, or a per-key
re-issue runbook. Names alone cannot meet a 4-hour restore target — a fresh
project needs ~60 secrets re-minted."* Against a 103-name inventory that reads
as a large, vague job, which is a good reason to keep not starting it.

It is much smaller than 103, and it is the wrong shape. Two findings.

## Finding 1 — the most irreplaceable secret in the system is not in the inventory

`docs/security/secrets-inventory.md` lists **`BACKUP_AGE_RECIPIENT`**, which is
the *public* half of the backup encryption keypair. The **private identity** —
the only thing that can ever decrypt a backup archive — appears nowhere in the
103 names.

It exists on this machine at
`%USERPROFILE%\Documents\twofer-backup-age-identity.txt` (189 bytes, modified
2026-07-30), with a second copy on a USB drive that has still not been verified.

The inventory's recovery guidance for that row makes the gap concrete. It says:

> mint a backup-only credential with write-with-retention and read-for-drill scope

That is right for an S3 key and wrong for this. You cannot mint a new age key
and read yesterday's backups with it. **If both copies of the private identity
are lost, every archive in B2 becomes permanently unreadable** — Object Lock
guarantees they still exist, and nobody can decrypt them. That is the one value
in the estate with no provider, no support ticket, and no re-issue path.

It is missing from the inventory because the inventory is generated from
secret/config *names referenced in code*, and the private identity is
deliberately never referenced in code. The generator cannot see it. Worth
adding by hand, with recovery text that says what is actually true.

## Finding 2 — 4 values, not 103

Classifying every name by *what happens if the value is lost*:

| Class | Count | What it means | What the founder must do |
| --- | ---: | --- | --- |
| **A — irreplaceable** | **4** | Cannot be re-created or re-issued. Losing the value loses data or capability | **Capture the value offline** |
| B — re-issuable | 27 | A provider will mint a new one on demand | Secure the *account*, not the value — this is Phase 2 |
| C — config | 66 | Limits, flags, model names, project refs, URLs, price IDs | Nothing. Recoverable from the repo or a console |
| D — test logins | 6 | Throwaway QA/smoke accounts | Password manager; not disaster recovery |

Reproduce the split at any time — the classification lives in this document,
and the name list comes straight from the inventory table.

### Class A in full

| Name | Why it cannot be re-issued |
| --- | --- |
| *(the age private identity — not currently an inventory row; see Finding 1)* | Only key that decrypts existing backups |
| `ANON_ABUSE_IP_HASH_SECRET` | HMAC pepper for stored IP hashes. A new value does not match historical rows, so abuse-dedup history silently stops correlating |
| `QR_SCAN_IP_HASH_SECRET` | Same, for QR scan dedup |
| `APPLE_PASS_KEY_PEM_B64` | Wallet pass signing private key. Apple will issue a *new* pass type certificate, but passes already in customers' wallets were signed with this one |
| `APPLE_PASS_CERT_PEM_B64` | The matching certificate |

`APPLE_WWDR_CERT_PEM_B64` is deliberately in class B: it is Apple's public
intermediate, downloadable from Apple at any time.

`ADMIN_SESSION_ENCRYPTION_KEY` is class B too, which is worth saying out loud
because the name suggests otherwise. Losing it invalidates every live admin
session — everyone signs in again — and a fresh 32 random bytes fully restores
the system. Annoying, not irreplaceable.

## Why this changes the task

The item as written implies capturing ~60 values into an encrypted vault before
the recovery position improves. In practice:

- **5 values need to be offline** (the four above plus the age identity), and
  two of them are two lines of base64.
- **27 need a working account and MFA recovery**, which is Phase 2 — already on
  the list, already the biggest single sitting. Vaulting their current values
  adds little: a stolen-then-rotated key makes the vaulted copy wrong, and a
  disaster scenario mints new ones anyway.
- **66 need nothing at all.** Putting price IDs and `AI_COOLDOWN_SECONDS` in a
  disaster vault is work that produces no recovery capability.

That reframing does not close the item — a founder still has to move five values
into an offline store — but it turns a vague afternoon into about fifteen
minutes, and it puts the genuinely fatal one first.

## Suggested order

1. **Verify the USB copy of the age identity**, still outstanding from
   2026-07-31. One command from the drive:
   `age-keygen -y <drive>:\twofer-backup-age-identity.txt` must print
   `age14h87sed9kx36vk2ufpyh6jr9uwflqvqnzr37f4u47pafncvfryxstt9qqz`.
2. Add a third copy somewhere that is not flash memory — a password-manager
   secure note or paper in a safe. Unpowered flash degrades and this key has no
   expiry.
3. Capture the four class-A values into the same store.
4. Add the age private identity to `secrets-inventory.md` as a row whose
   recovery column says plainly that it cannot be re-issued.
5. Treat the other 97 as Phase 2 account security, which is where they belong.
