-- Close client EXECUTE on the QR-campaign SECURITY DEFINER functions.
--
-- 20260815130000 revoked these only FROM PUBLIC. On Supabase, anon and
-- authenticated receive EXECUTE on new public-schema functions via default
-- privileges, so a PUBLIC-only revoke leaves them callable with the anon key
-- (same lesson recorded in 20260813120000). The tables in that migration got
-- the explicit role revoke; the functions did not. Both scan recording and
-- analytics are SECURITY DEFINER with row_security off, so until this runs,
-- any anon-key holder can dump cross-tenant campaign analytics or forge scan
-- telemetry. The follow-up CREATE OR REPLACE migrations (20260815131000,
-- 20260815132000) preserved the original grants and did not fix this.

REVOKE ALL ON FUNCTION public.record_qr_campaign_scan(text, text, text, text, date, text, boolean) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.qr_campaign_analytics(integer) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.redact_expired_qr_scan_metadata() FROM anon, authenticated;
