# Exact File Diffs - All Changes

## Summary
- **8 files changed** (2 new, 6 modified)
- **1 migration file** (NEW - complete schema)
- **2 Edge Functions** (REWRITTEN)
- **1 client library** (MODIFIED - added redeemToken)
- **3 new screens** (redeem.tsx, dashboard.tsx, updated _layout.tsx)
- **1 icon mapping** (MODIFIED)

---

## 1. Database Migration (NEW FILE)

**File:** `supabase/migrations/20250127000000_initial_schema.sql`

**Status:** NEW FILE (entire file is new)

**Key additions:**
- Tables: `businesses`, `deals`, `deal_claims`, `favorites`
- RLS enabled on all tables
- Policies for SELECT/INSERT/UPDATE operations
- **Critical:** Policy "Businesses can update claims for their deals" (lines 142-152) - allows redemption

**Critical section:**
```sql
-- Lines 142-152: NEW POLICY (was missing)
CREATE POLICY "Businesses can update claims for their deals"
  ON deal_claims FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM deals
      JOIN businesses ON businesses.id = deals.business_id
      WHERE deals.id = deal_claims.deal_id
      AND businesses.owner_id = auth.uid()
    )
  );
```

---

## 2. Edge Function: claim-deal (REWRITTEN)

**File:** `supabase/functions/claim-deal/index.ts`

### Before (Original):
```typescript
// Hardcoded 5-minute expiration
const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

// No validation
// No existing claim check
// No max_claims check
// Basic error handling
```

### After (Current):
```typescript
// Lines 4-7: NEW - CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Lines 10-13: NEW - CORS preflight handling
if (req.method === "OPTIONS") {
  return new Response("ok", { headers: corsHeaders });
}

// Lines 73-88: NEW - Deal validation
const { data: deal, error: dealError } = await supabase
  .from("deals")
  .select("id, business_id, end_time, claim_cutoff_buffer_minutes, max_claims, is_active")
  .eq("id", dealId)
  .single();

if (dealError || !deal) {
  return new Response(JSON.stringify({ error: "Deal not found" }), { status: 404, ... });
}

if (!deal.is_active) {
  return new Response(JSON.stringify({ error: "This deal is not active" }), { status: 400, ... });
}

// Lines 100-125: NEW - Expiration and cutoff validation
const now = new Date();
const endTime = new Date(deal.end_time);
const cutoffBufferMinutes = deal.claim_cutoff_buffer_minutes || 30;
const claimCutoffTime = new Date(endTime.getTime() - cutoffBufferMinutes * 60 * 1000);

if (now >= endTime) {
  return new Response(JSON.stringify({ error: "This deal has expired" }), { status: 400, ... });
}

if (now >= claimCutoffTime) {
  return new Response(JSON.stringify({ error: `Claiming has closed...` }), { status: 400, ... });
}

// Lines 127-155: NEW - Existing claim check (returns existing token)
const { data: existingClaims, error: existingError } = await supabase
  .from("deal_claims")
  .select("id, token, expires_at, redeemed_at")
  .eq("deal_id", dealId)
  .eq("user_id", user.id)
  .order("created_at", { ascending: false })
  .limit(1);

if (existingClaims && existingClaims.length > 0) {
  const existingClaim = existingClaims[0];
  if (!existingClaim.redeemed_at) {
    const existingExpires = new Date(existingClaim.expires_at);
    if (existingExpires > now) {
      return new Response(JSON.stringify({
        token: existingClaim.token,
        expires_at: existingClaim.expires_at,
        message: "You already have an active claim for this deal",
      }), { status: 200, ... });
    }
  }
}

// Lines 157-175: NEW - max_claims limit check
if (deal.max_claims !== null && deal.max_claims > 0) {
  const { count, error: countError } = await supabase
    .from("deal_claims")
    .select("*", { count: "exact", head: true })
    .eq("deal_id", dealId);

  if (count !== null && count >= deal.max_claims) {
    return new Response(JSON.stringify({ error: "This deal has reached its claim limit" }), { status: 400, ... });
  }
}

// Lines 177-180: CHANGED - Token expiration based on deal
const token = crypto.randomUUID();
const expiresAt = claimCutoffTime.toISOString(); // Was: Date.now() + 5 * 60 * 1000

// Lines 192-211: IMPROVED - Better error handling
if (insertError) {
  if (insertError.code === "23505") {
    return new Response(JSON.stringify({ error: "You already have an active claim..." }), { status: 409, ... });
  }
  return new Response(JSON.stringify({ error: `Failed to create claim: ${insertError.message}` }), { status: 500, ... });
}
```

**Key changes:**
- ✅ Deal validation (exists, active, not expired)
- ✅ Claim cutoff window enforcement
- ✅ Existing claim check (returns existing token)
- ✅ max_claims limit enforcement
- ✅ Token expiration based on deal's `claim_cutoff_buffer_minutes`
- ✅ CORS headers added
- ✅ All errors return JSON with `{ error: "message" }`

---

## 3. Edge Function: redeem-token (REWRITTEN)

**File:** `supabase/functions/redeem-token/index.ts`

### Before (Original):
```typescript
// Wrong env vars
const supabaseUrl = Deno.env.get("PROJECT_URL");
const serviceKey = Deno.env.get("PROJECT_SERVICE_ROLE_KEY");

// No auth check
// No business ownership check
// No deal ownership validation
// Plain text error responses
```

### After (Current):
```typescript
// Lines 4-7: NEW - CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Lines 10-13: NEW - CORS preflight
if (req.method === "OPTIONS") {
  return new Response("ok", { headers: corsHeaders });
}

// Lines 26-27: FIXED - Correct env vars
const supabaseUrl = Deno.env.get("SUPABASE_URL")!; // Was: PROJECT_URL
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Lines 29-39: NEW - Auth header forwarding
const supabase = createClient(
  supabaseUrl,
  supabaseServiceKey,
  {
    global: {
      headers: {
        Authorization: req.headers.get("Authorization")!,
      },
    },
  }
);

// Lines 41-55: NEW - User authentication
const { data: { user }, error: userError } = await supabase.auth.getUser();

if (userError || !user) {
  return new Response(JSON.stringify({ error: "Unauthorized. Please log in as a business owner." }), { status: 401, ... });
}

// Lines 57-72: NEW - Business ownership check
const { data: business, error: businessError } = await supabase
  .from("businesses")
  .select("id")
  .eq("owner_id", user.id)
  .single();

if (businessError || !business) {
  return new Response(JSON.stringify({ error: "You must be a business owner to redeem tokens." }), { status: 403, ... });
}

// Lines 100-123: NEW - Fetch claim with deal and business info
const { data: claim, error: claimError } = await supabase
  .from("deal_claims")
  .select(`
    *,
    deal:deals!inner(
      id,
      business_id,
      title,
      business:businesses!inner(id, owner_id)
    )
  `)
  .eq("token", token)
  .single();

// Lines 125-135: NEW - Deal ownership validation
const deal = claim.deal as any;
if (!deal || deal.business?.owner_id !== user.id) {
  return new Response(JSON.stringify({ error: "This token does not belong to your business" }), { status: 403, ... });
}

// Lines 137-146: NEW - Already redeemed check
if (claim.redeemed_at) {
  return new Response(JSON.stringify({ error: "This token has already been redeemed" }), { status: 409, ... });
}

// Lines 148-159: NEW - Expiration check
const now = new Date();
const expiresAt = new Date(claim.expires_at);
if (expiresAt < now) {
  return new Response(JSON.stringify({ error: "This token has expired" }), { status: 410, ... });
}

// Lines 162-176: IMPROVED - Better error handling
const { error: updateError } = await supabase
  .from("deal_claims")
  .update({ redeemed_at: now.toISOString() })
  .eq("token", token);

if (updateError) {
  return new Response(JSON.stringify({ error: `Failed to redeem token: ${updateError.message}` }), { status: 500, ... });
}

// Lines 179-189: IMPROVED - Success response includes deal info
return new Response(JSON.stringify({
  success: true,
  deal_title: deal.title,
  redeemed_at: now.toISOString(),
}), { status: 200, ... });
```

**Key changes:**
- ✅ Fixed env vars (`SUPABASE_URL` instead of `PROJECT_URL`)
- ✅ User authentication required
- ✅ Business ownership verification
- ✅ Deal ownership validation (token must belong to business's deal)
- ✅ Already redeemed check
- ✅ Expiration check
- ✅ All errors return JSON with `{ error: "message" }`
- ✅ CORS headers added

---

## 4. Client Functions Library (MODIFIED)

**File:** `lib/functions.ts`

### Added:
```typescript
// Lines 3-35: NEW - Improved error parsing function
function parseFunctionError(error: any): string {
  let errorMessage = "Unknown error";
  
  // Try error.context.body first (parsed JSON)
  if (error.context?.body && typeof error.context.body === "object") {
    if (error.context.body.error) {
      return error.context.body.error;
    }
  }
  
  // Try error.message (might be JSON string)
  if (error.message) {
    errorMessage = error.message;
    try {
      const parsed = JSON.parse(errorMessage);
      if (parsed.error) {
        return parsed.error;
      }
    } catch {
      // Not JSON, use original message
    }
  }
  
  return errorMessage || error.context?.message || "Unknown error";
}

// Lines 61-84: NEW - redeemToken function
export async function redeemToken(token: string) {
  const { data, error } = await supabase.functions.invoke("redeem-token", {
    body: { token },
  });

  if (error) {
    throw new Error(parseFunctionError(error));
  }

  if (data && typeof data === "object" && "error" in data) {
    throw new Error((data as any).error || "Server returned an error");
  }

  if (!data || !data.success) {
    throw new Error("Token redemption failed");
  }

  return data as {
    success: boolean;
    deal_title?: string;
    redeemed_at: string;
  };
}
```

### Modified:
```typescript
// Lines 37-59: MODIFIED - claimDeal now uses parseFunctionError
export async function claimDeal(dealId: string) {
  const { data, error } = await supabase.functions.invoke("claim-deal", {
    body: { deal_id: dealId },
  });

  if (error) {
    throw new Error(parseFunctionError(error)); // Was: throw new Error(error.message);
  }
  // ... rest unchanged
}
```

**Key changes:**
- ✅ Added `parseFunctionError()` for better error parsing
- ✅ Added `redeemToken()` function
- ✅ Improved error handling in `claimDeal()`

---

## 5. Redeem Scanner Screen (NEW FILE)

**File:** `app/(tabs)/redeem.tsx`

**Status:** NEW FILE (263 lines)

**Key features:**
- Camera permission handling
- QR code scanning via `expo-barcode-scanner`
- Business owner verification
- Calls `redeemToken()` from `lib/functions.ts`
- Success/error alerts
- Scan again functionality

**Critical sections:**
```typescript
// Lines 7-10: State management
const [hasPermission, setHasPermission] = useState<boolean | null>(null);
const [scanned, setScanned] = useState(false);
const [isRedeeming, setIsRedeeming] = useState(false);
const [isBusinessOwner, setIsBusinessOwner] = useState(false);

// Lines 21-40: Business ownership check
useEffect(() => {
  // Check if user owns a business
  if (session?.user?.id) {
    const { data } = await supabase
      .from("businesses")
      .select("id")
      .eq("owner_id", session.user.id)
      .single();
    setIsBusinessOwner(!!data);
  }
}, []);

// Lines 42-75: QR scan handler
const handleBarCodeScanned = async ({ data: token }: BarCodeScannerResult) => {
  if (scanned || isRedeeming) return;
  setScanned(true);
  setIsRedeeming(true);

  try {
    const result = await redeemToken(token);
    Alert.alert("Success!", `Token redeemed for: ${result.deal_title}...`);
  } catch (error: any) {
    Alert.alert("Redemption failed", error.message);
  }
};
```

---

## 6. Business Dashboard Screen (NEW FILE)

**File:** `app/(tabs)/dashboard.tsx`

**Status:** NEW FILE (290 lines)

**Key features:**
- Stats: claims today, redeemed today, total claims, total redeemed
- Conversion rate calculation
- Recent claims list with status (active/expired/redeemed)
- Pull-to-refresh

**Critical sections:**
```typescript
// Lines 157-185: Stats calculation
const claimsToday = (allClaims || []).filter((c) => {
  const createdAt = new Date(c.created_at).getTime();
  return createdAt >= todayStartTime && createdAt <= todayEndTime;
}).length;

const redeemedToday = (allClaims || []).filter((c) => {
  if (!c.redeemed_at) return false;
  const redeemedAt = new Date(c.redeemed_at).getTime();
  return redeemedAt >= todayStartTime && redeemedAt <= todayEndTime;
}).length;

const totalRedeemed = (allClaims || []).filter((c) => c.redeemed_at !== null).length;
```

---

## 7. Tab Layout (MODIFIED)

**File:** `app/(tabs)/_layout.tsx`

### Added:
```typescript
// Lines 26-35: NEW - Redeem and Dashboard tabs
<Tabs.Screen
  name="redeem"
  options={{
    title: 'Redeem',
    tabBarIcon: ({ color }) => <IconSymbol size={28} name="qrcode.viewfinder" color={color} />,
  }}
/>
<Tabs.Screen
  name="dashboard"
  options={{
    title: 'Dashboard',
    tabBarIcon: ({ color }) => <IconSymbol size={28} name="chart.bar.fill" color={color} />,
  }}
/>
```

---

## 8. Icon Symbol Mapping (MODIFIED)

**File:** `components/ui/icon-symbol.tsx`

### Added:
```typescript
// Lines 16-21: NEW - Icon mappings for new tabs
const MAPPING = {
  'house.fill': 'home',
  'paperplane.fill': 'send',
  'chevron.left.forwardslash.chevron.right': 'code',
  'chevron.right': 'chevron-right',
  'qrcode.viewfinder': 'qr-code-scanner',      // NEW
  'chart.bar.fill': 'bar-chart',               // NEW
} as IconMapping;
```

---

## 9. Config Update (MODIFIED)

**File:** `supabase/config.toml`

### Changed:
```toml
# Line 58: CHANGED
schema_paths = ["./migrations/*.sql"]  # Was: []
```

---

## 10. Seed File (NEW FILE)

**File:** `supabase/seed_test_data.sql`

**Status:** NEW FILE

**Purpose:** Creates test business and deal for verification

**Key sections:**
- Gets user ID from `auth.users` by email
- Creates business with `ON CONFLICT` handling
- Creates active deal with all required fields
- Verification queries at end

---

## Verification Checklist

See `PROOF_CHECKLIST.md` for complete verification steps.

### Quick Verification Commands:

```bash
# 1. Apply schema
supabase db push

# 2. Deploy functions
supabase functions deploy claim-deal
supabase functions deploy redeem-token

# 3. Check logs
supabase functions logs claim-deal --tail
supabase functions logs redeem-token --tail
```

### Expected Database States:

**After Claim:**
- `deal_claims.redeemed_at` = **NULL** ✅

**After Redeem:**
- `deal_claims.redeemed_at` = **TIMESTAMP** ✅ (was NULL, now set)

---

## Critical Fixes Applied

1. ✅ **RLS Policy for UPDATE** - Added "Businesses can update claims for their deals" policy
2. ✅ **Env Vars Fixed** - `SUPABASE_URL` instead of `PROJECT_URL` in redeem-token
3. ✅ **Business Auth** - redeem-token now requires business ownership
4. ✅ **Deal Ownership** - Token must belong to business's deal
5. ✅ **Error Format** - All errors return JSON `{ error: "message" }`
6. ✅ **Token Expiration** - Based on deal's `claim_cutoff_buffer_minutes`
7. ✅ **Existing Claim Check** - Returns existing token if user already claimed

---

**No claims of success - verification required per PROOF_CHECKLIST.md**
