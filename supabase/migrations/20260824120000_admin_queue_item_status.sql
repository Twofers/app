-- Persist operator workflow state for deterministic, rules-derived admin queue
-- issues. The issue itself remains computed by admin-dashboard-summary; this
-- table stores only the owner/admin/support overlay.
--
-- Applying this migration changes hosted data and remains explicitly gated.

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_queue_item_status (
  issue_key text PRIMARY KEY,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'reviewing', 'waiting_owner', 'resolved', 'dismissed')),
  note text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_queue_item_status_key_check
    CHECK (
      char_length(issue_key) BETWEEN 3 AND 200
      AND issue_key ~ '^[a-z0-9_:-]+$'
    ),
  CONSTRAINT admin_queue_item_status_note_check
    CHECK (note IS NULL OR char_length(note) <= 1000)
);

CREATE INDEX IF NOT EXISTS idx_admin_queue_item_status_status_updated
  ON public.admin_queue_item_status (status, updated_at DESC);

ALTER TABLE public.admin_queue_item_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_queue_item_status FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_queue_item_status_deny_clients"
  ON public.admin_queue_item_status;
CREATE POLICY "admin_queue_item_status_deny_clients"
  ON public.admin_queue_item_status
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (COALESCE(false, false))
  WITH CHECK (COALESCE(false, false));

REVOKE ALL ON TABLE public.admin_queue_item_status FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_queue_item_status TO service_role;

COMMENT ON TABLE public.admin_queue_item_status IS
  'Service-role-only operator state over deterministic admin queue issue keys; derived issues remain in admin-dashboard-summary.';

COMMIT;
