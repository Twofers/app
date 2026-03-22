# Proof Checklist - Quick Tests

## Commands to Run

```bash
# 1. Install dependencies (if needed)
npm install

# 2. Apply database schema (if not already applied)
supabase db push

# 3. Deploy redeem-token function
supabase functions deploy redeem-token

# 4. Start Expo app
npx expo start -c
```

## Test 1: Claim Deal

1. Open app in Expo Go
2. Login (Explore tab)
3. Go to Home tab
4. Tap "Claim" on a deal
5. **Expected:** QR code appears with expiration time
6. **Verify in DB:**
```sql
SELECT token, expires_at, redeemed_at 
FROM deal_claims 
ORDER BY created_at DESC LIMIT 1;
-- Expected: redeemed_at = NULL ✅
```

## Test 2: Scan & Redeem

1. Go to Redeem tab
2. Grant camera permission if prompted
3. Point camera at QR code from Test 1
4. **Expected:** Success alert with deal title and redemption time
5. **Verify in DB:**
```sql
SELECT token, expires_at, redeemed_at 
FROM deal_claims 
WHERE redeemed_at IS NOT NULL 
ORDER BY redeemed_at DESC LIMIT 1;
-- Expected: redeemed_at = [recent timestamp] ✅ (was NULL before)
```

## Test 3: Verify Database Update

```sql
-- Before redemption
SELECT redeemed_at FROM deal_claims WHERE token = '[your_token]';
-- Expected: NULL

-- After redemption
SELECT redeemed_at FROM deal_claims WHERE token = '[your_token]';
-- Expected: [timestamp] ✅
```

## Success Criteria

- ✅ App starts without crashes
- ✅ Camera permission requested
- ✅ QR scanning works
- ✅ Claim creates row with redeemed_at = NULL
- ✅ Redeem updates redeemed_at to timestamp
- ✅ All errors are human-readable
