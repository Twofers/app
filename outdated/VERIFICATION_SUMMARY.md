# Verification Summary

## Critical Fix: RLS Policy for Redemption

**Issue Found:** Businesses couldn't update `deal_claims.redeemed_at` because RLS policy was missing.

**Fix Applied:** Added policy in migration:
```sql
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

**Action Required:** Run `supabase db push` again to apply this policy.

---

## Files Created/Updated

1. **`PROOF_CHECKLIST.md`** - Complete verification guide with:
   - SQL queries to verify schema + RLS
   - Seed SQL block for test data
   - Step-by-step client test instructions
   - Expected database states after each operation
   - Troubleshooting guide

2. **`supabase/seed_test_data.sql`** - Standalone seed file (easier to run)

3. **`supabase/migrations/20250127000000_initial_schema.sql`** - Added missing UPDATE policy

---

## Quick Start Verification

### 1. Apply Schema (if not done)
```bash
supabase db push
```

### 2. Create Test Data
- Sign up via app with email: `test@example.com`
- Run `supabase/seed_test_data.sql` in Supabase SQL Editor (replace email)

### 3. Test Claim Flow
- Login in app
- Go to Home tab
- Tap "Claim" on deal
- Verify QR appears
- Check database: `SELECT * FROM deal_claims ORDER BY created_at DESC LIMIT 1;`
- **Expected:** `redeemed_at = NULL` ✅

### 4. Test Redeem Flow
- Go to Redeem tab
- Scan QR code
- Verify success alert
- Check database: `SELECT * FROM deal_claims WHERE redeemed_at IS NOT NULL ORDER BY redeemed_at DESC LIMIT 1;`
- **Expected:** `redeemed_at = [timestamp]` ✅

---

## Expected Database States

### After Claim (Before Redeem)
```
deal_claims row:
- token: UUID string ✅
- expires_at: Future timestamp ✅
- redeemed_at: NULL ✅ (critical!)
- All other fields: Set correctly
```

### After Redeem
```
Same deal_claims row:
- token: Same UUID ✅ (unchanged)
- expires_at: Same timestamp ✅ (unchanged)
- redeemed_at: NOW SET ✅ (was NULL, now timestamp)
- All other fields: Unchanged ✅
```

---

## Most Common Failures & Fixes

| Error | Root Cause | Fix |
|-------|------------|-----|
| "Edge Function returned non-2xx" | Function error | Check logs: `supabase functions logs claim-deal --tail` |
| "Unauthorized" | Not logged in | Login via app first |
| "You must be a business owner" | Business not created | Run seed SQL |
| "redeemed_at still NULL" | RLS blocking UPDATE | Run `supabase db push` to add UPDATE policy |
| "Invalid token" | Token not found | Verify token matches QR code value |
| "This token does not belong to your business" | Deal ownership mismatch | Check deal.business_id matches your business |

---

See `PROOF_CHECKLIST.md` for complete detailed verification steps.
