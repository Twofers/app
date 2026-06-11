# EAS iOS credentials check runbook (Dan executes)

Prepared 2026-06-10. Read-only health check of the iOS signing credentials and APNs push
key stored on EAS. Per the repo hard gates, agents do not run these commands or print
credential output; this is a human task.

Repo facts the output must match:
- Bundle id: `com.unvmex2.twoforone` (`app.json`)
- Build profiles in `eas.json`: `development`, `preview`, `ios-sim`, `production`,
  `dev-client-apk`, `apk`. Use **production** for this check.

## Commands

```powershell
# 1. Confirm you're on the project-owning Expo account
eas whoami

# 2. The inspector (interactive). Pick: iOS -> production.
eas credentials --platform ios
```

The menu prints the credentials summary as soon as you select the platform/profile —
that summary IS the check. Don't select any action that says set up, generate, or
remove; choose "Go back" or Ctrl+C to exit.

## Healthy output

Distribution certificate + provisioning profile block:

```
Distribution Certificate
  Serial Number     <hex>
  Expiration Date   <a future date>
  Apple Team        <TEAM_ID> (your team name)

Provisioning Profile
  Developer Portal ID   <id>
  Status                active
  Expiration            <a future date>
  Apple Team            <TEAM_ID>
```

Healthy = Status **active**, expiration in the future, team ID matches your Apple
Developer team, bundle id shown is `com.unvmex2.twoforone`.

Push key (APNs) block:

```
Push Key
  Developer Portal ID   <10-char key id>
  Key ID                <same>
  Apple Team            <TEAM_ID>
```

Healthy = a key ID is listed and assigned to this app, correct team. APNs `.p8` keys
never expire, so presence + team is the whole test. (One key serves the whole team;
Apple caps a team at 2 APNs keys.)

## Failure signatures and responses

| Symptom | Meaning | Action |
| --- | --- | --- |
| `No push key configured` / push key section absent | APNs key never uploaded to EAS, or removed | Menu: Push Notifications -> set up. If the team already has 2 keys in the Apple portal, do not generate a third (Apple blocks it) — upload an existing `.p8` instead. |
| Push key listed in EAS but shows revoked at developer.apple.com -> Keys | Pushes silently fail | Upload a valid existing key, or generate one only if under the 2-key cap, then assign it in EAS. |
| Provisioning profile `Status: invalid` or expired | Profile lapsed or invalidated by a cert change | Menu: Build credentials -> provisioning profile -> regenerate. Safe; doesn't touch the cert. |
| Distribution certificate expired or revoked | New builds can't sign | Let EAS generate a new distribution cert, then regenerate the profile. Team cap is 2 iOS distribution certs — revoke a dead one in the Apple portal first if at the cap. |
| `Authentication with Apple Developer Portal failed` / ASC API key errors | EAS can't talk to Apple (expired ASC API key or session) | Re-auth with your Apple ID when prompted, or refresh the App Store Connect API Key via the credentials menu. |
| Team ID or bundle id doesn't match `com.unvmex2.twoforone` | Wrong Apple team or wrong project | Stop — regenerate nothing. Check `eas whoami`, the project the directory points at, and the Apple team on the account. |
| `eas whoami` shows the wrong account or not logged in | Wrong EAS session | `eas login` with the project-owning account. |

Everything in the menu is read-only until you pick an action. The only destructive
options are the "remove" ones — a health check never needs them.
