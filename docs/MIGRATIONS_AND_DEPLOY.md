# Migrations & Edge Function deploy

## 1. `businesses.preferred_locale`

**File:** `supabase/migrations/20260130120000_business_preferred_locale.sql`

**What it does:** Adds nullable `preferred_locale` (`TEXT`). `NULL` = client uses **app UI language** for AI output and deal-quality banners.

### Apply (local / linked project)

From the repo root, with [Supabase CLI](https://supabase.com/docs/guides/cli) logged in:

```bash
supabase db push
```

Or run the SQL in the Supabase Dashboard → **SQL Editor** (paste migration contents).

### Requirement

The app selects `preferred_locale` in `hooks/use-business.ts`. If the column is missing, that query fails at runtime. **Apply this migration before shipping** the i18n branch to production.

---

## 2. `ai-generate-ad-variants` Edge Function

**File:** `supabase/functions/ai-generate-ad-variants/index.ts`

**Client:** Sends `output_language`: `"en"` | `"es"` | `"ko"` (from `resolveDealFlowLanguage`).

**Behavior:** Function normalizes to `en`/`es`/`ko`, injects **OUTPUT LANGUAGE** + localized `rationale` instruction into the system prompt.

### Secrets / env (Supabase project)

| Variable | Required |
|----------|----------|
| `OPENAI_API_KEY` | Yes |
| `SUPABASE_URL` | Auto |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto |
| `OPENAI_AD_MODEL` | Optional (default `gpt-4o-mini`) |

### Deploy

```bash
supabase functions deploy ai-generate-ad-variants
```

Redeploy after any change to `index.ts`.

---

## 3. Language matrix (product)

| App UI | `preferred_locale` | AI / deal-quality output |
|--------|--------------------|---------------------------|
| `en` | `NULL` | English |
| `es` | `NULL` | Spanish |
| `ko` | `NULL` | Korean |
| `en` | `ko` | Korean |
| `ko` | `NULL` | Korean |
| `es` | `en` | English |

Implemented in `resolveDealFlowLanguage()` in `lib/translate-deal-quality.ts`. Covered by `lib/resolve-deal-flow-language.locale.test.ts`.
