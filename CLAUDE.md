# TWOFER — Claude Code Instructions

## Project Overview

TWOFER is a local BOGO deals app for independent cafes and bakeries, targeting DFW suburbs (Irving, Coppell, Grapevine, Carrollton). Pilot goal: 10 founding cafes on a 60-day free trial.

**Tech stack:** Expo React Native + Expo Router + Supabase (edge functions on Deno)
**Primary test target:** Android (emulator or physical device)

---

## Local Setup

```bash
npm install
# Create .env with:
# EXPO_PUBLIC_SUPABASE_URL=...
# EXPO_PUBLIC_SUPABASE_ANON_KEY=...
npx supabase start
npx expo start        # press 'a' for Android emulator
```

To seed the demo account:
```bash
npm run seed:demo
```

To reset and rebuild migrations:
```bash
npx supabase stop && npx supabase start
npx expo start -c     # -c clears the Metro cache
```

---

## Brand & Design

- **Name:** TWOFER (always fully capitalized)
- **Mascot:** Penguin (prominent on auth screen and branding)
- **Primary color:** `#FF9F1C` (bright penguin orange)
- **Background:** pure white
- **All buttons and accents:** bright orange
- **Card style:** hero-style, deep shadows, 24px corner radius
- **Animations:** Reanimated

---

## Project Rules for Claude Code

- This is a React Native Expo app with Expo Router and Supabase backend
- ALWAYS run `npx expo start` after making changes to verify the app still starts
- NEVER make changes to more than 3 files without testing in between
- If a fix requires changing navigation structure, test navigation BEFORE fixing anything else
- Show user-friendly error messages, never raw error objects
- Android is the primary test target
- When you finish a task, tell me exactly how to test it and what I should see on my screen

---

## Key Files

| File | Purpose |
|---|---|
| `app/_layout.tsx` | Root navigator |
| `components/providers/auth-session-provider.tsx` | Auth listener (Supabase session subscription) |
| `app/index.tsx` | Cold-start auth gate — redirects to login or tabs |
| `app/auth-landing.tsx` | Login/signup screen |
| `app/business-setup.tsx` | Business onboarding form |
| `app/(tabs)/_layout.tsx` | Bottom tab navigator |
| `app/(tabs)/index.tsx` | Consumer deal feed |
| `app/(tabs)/dashboard.tsx` | Business analytics |
| `app/create/ai.tsx` | Create a BOGO deal (single-ad pipeline + photo enhancement) |
| `app/create/menu-offer.tsx` | Menu-based offer wizard (redirects to ai.tsx) |
| `hooks/use-business.ts` | Auth + business data hook (uses get_my_business RPC for PII) |
| `lib/supabase.ts` | Supabase client |
| `constants/theme.ts` | Colors, spacing, radii (use `theme.primaryAccent` for orange-on-white text — `theme.primary` is button-fill only) |
| `supabase/migrations/` | All DB migrations (run in order) |

---

## Do Not Touch

- **Strong-deal guardrail** — client + server validation that rejects weak deals. Do not weaken or bypass this.
- **Orange theme** — do not change primary color or button styles without explicit instruction.
- **Reanimated animations** — preserve existing animations on deal cards and success toasts.
