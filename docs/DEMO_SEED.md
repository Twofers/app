# Preview / dev: demo coffee business seed

This path seeds a **repeatable** demo business and sample deals for the `demo@demo.com` test account (see `EXPO_PUBLIC_ENABLE_DEMO_AUTH_HELPER` in `eas.json` preview/development profiles).

## Prerequisites

1. Apply Supabase migrations (includes `poster_storage_path` and public read on `deal-photos`).
2. Create the demo user once via the app’s **Demo login** button (or sign up `demo@demo.com` / `demo12345` manually in Supabase Auth).
3. Run the SQL in the Supabase SQL Editor (hosted project or local).

## Script

- File: [`supabase/seed_demo_coffee_business.sql`](../supabase/seed_demo_coffee_business.sql)
- Behavior:
  - Resolves `owner_id` from `auth.users` where `email = 'demo@demo.com'` (case-insensitive).
  - Upserts one business row on `owner_id` (one business per owner).
  - Deletes existing deals for that business, then inserts three active deals with **public HTTPS** poster URLs (no storage upload required).
  - New demo businesses use fixed UUID `a0000000-0000-4000-8000-00000000c0de`; if `demo@demo.com` already had a business, that row’s id is reused and updated instead.

## Re-run

Safe to run multiple times: deals for the demo business are replaced; business profile is updated.

## AI create-deal

After seeding, sign in as the demo business owner, complete **business setup** if prompted, open **Create → AI** flow, upload or pick a photo, and publish. If OpenAI or Edge secrets are missing, the app shows the existing friendly errors from `create/ai.tsx` — no production auth bypass.

## Android maps

For stable Google Maps on Android device builds, set `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` in EAS env or `.env` and rebuild (see `app.config.js`).
