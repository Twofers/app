# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## AI ad generation (business)

The **Create → AI ad ideas** flow calls the Supabase Edge Function `ai-generate-ad-variants`.

1. Set secrets (Supabase project → Edge Functions → Secrets):

   - `OPENAI_API_KEY` (required)
   - `OPENAI_AD_MODEL` (optional, default `gpt-4o-mini` — use a cheaper/faster model when you want)

2. Deploy the function:

   ```bash
   supabase functions deploy ai-generate-ad-variants
   ```

3. The app uploads the photo to the `deal-photos` bucket first; the function uses a short-lived signed URL for vision input. Keys never ship in the client.

### AI ads — product brief

See **`docs/twofer-ai-ad-mvp.md`** for MVP definition of done, 12 QA test cases, guardrails, and metrics.  
Product calls (regen cap, moderation stance, profile): **`docs/PRODUCT_DECISIONS_AI_ADS.md`**.  
Manual validation (12 cases, scorecard, QA tags + logs): **`docs/ai-ad-validation/README.md`**.

Apply DB migrations (includes optional business profile columns for AI context):

```bash
supabase db push
# or run new migration files against your project
```

### AI ads — analytics & logs

- **Client:** `lib/analytics.ts` logs `[analytics] <event>` in **development** (`__DEV__`). Wire `setAnalyticsSink()` to forward events to PostHog, Segment, or your API in production.
- **Server:** Edge Function logs JSON lines with `tag: "ai_ads"` (`generation_ok`, `openai_error`, `parse_error`, `lane_validation_failed`) for Supabase function log drains.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
