# Repository Audit Report

## Current Implementation Status

### ✅ What's Working
1. **Supabase Client Setup** (`lib/supabase.ts`)
   - Correctly configured with Expo SecureStore
   - Environment variables set up

2. **Authentication** (`app/(tabs)/auth.tsx`)
   - Sign up and sign in working
   - Basic error handling

3. **Home/Deals Screen** (`app/(tabs)/index.tsx`)
   - Loads deals from `deals` table
   - Displays deal list
   - Can claim deals (calls `claim-deal` function)
   - Shows QR code after claiming
   - Basic error handling

4. **Edge Functions Structure**
   - `claim-deal` function exists
   - `redeem-token` function exists
   - Both configured in `config.toml`

### ❌ Critical Issues Found

#### 1. Database Schema Missing
- **No migrations found** - Schema must be created manually or via SQL
- Assumed tables:
  - `deals` (id, title, description, end_time, is_active)
  - `deal_claims` (deal_id, user_id, token, expires_at, redeemed_at)
- Missing tables:
  - `businesses` (owner_id, name, etc.)
  - `favorites` (user_id, business_id)
  - Performance tracking tables/views

#### 2. claim-deal Function Issues (`supabase/functions/claim-deal/index.ts`)
- ❌ Hardcoded 5-minute expiration (should use deal's claim_cutoff_buffer)
- ❌ No validation that deal exists and is active
- ❌ No check for deal expiration or claim cutoff window
- ❌ No enforcement of max_claims limit
- ❌ No check for existing active claim (one per user per deal)
- ❌ No rate limiting
- ❌ Error messages not JSON-formatted properly
- ❌ Uses wrong env var pattern (should use SUPABASE_URL, not from Deno.env.get)

#### 3. redeem-token Function Issues (`supabase/functions/redeem-token/index.ts`)
- ❌ Uses wrong env vars (`PROJECT_URL` vs `SUPABASE_URL`)
- ❌ No business authentication (anyone can redeem any token)
- ❌ No validation that token belongs to business's deal
- ❌ Error responses not JSON-formatted consistently

#### 4. Client Error Handling (`lib/functions.ts`)
- ⚠️ Basic error handling exists but may not parse Edge Function errors correctly
- Edge Functions return non-2xx status codes, but error body may not be parsed

#### 5. Missing Screens
- ❌ Business: Create Deal
- ❌ Business: Redeem Scanner
- ❌ Business: Dashboard
- ❌ Customer: My Deals (claim history)
- ❌ Customer: Favorites

#### 6. Missing Features
- ❌ Poster images (deal-photos, deal-ads buckets)
- ❌ AI poster generation pipeline
- ❌ Favorites functionality
- ❌ Notifications
- ❌ Abuse protection (rate limits, token rotation)
- ❌ Billing counter

## Database Schema Assumptions (from code)

### deals table
```sql
- id (uuid, primary key)
- title (text, nullable)
- description (text, nullable)
- end_time (timestamp)
- is_active (boolean)
```

### deal_claims table
```sql
- deal_id (uuid, foreign key to deals)
- user_id (uuid, foreign key to auth.users)
- token (text/uuid)
- expires_at (timestamp)
- redeemed_at (timestamp, nullable)
```

## Next Steps Priority

1. **IMMEDIATE**: Fix claim-deal function to return proper JSON errors
2. **IMMEDIATE**: Create database schema migrations
3. **IMMEDIATE**: Fix client error parsing
4. Then: Build remaining screens and features
