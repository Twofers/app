-- Observable media-import jobs for website and owner-authorized social discovery.
--
-- Drafted for the AI ad generation master plan. Do not apply without Dan's
-- explicit migration approval. This migration is intentionally additive and
-- does not start, schedule, or deploy any importer.

BEGIN;

CREATE TABLE IF NOT EXISTS public.business_media_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  requested_url text,
  social_connection_id uuid REFERENCES public.business_social_connections(id) ON DELETE SET NULL,
  normalized_origin text,
  status text NOT NULL DEFAULT 'queued',
  pages_scanned integer NOT NULL DEFAULT 0,
  candidate_count integer NOT NULL DEFAULT 0,
  approved_count integer NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_media_import_jobs_source_type_check CHECK (
    source_type IN ('website', 'instagram', 'facebook')
  ),
  CONSTRAINT business_media_import_jobs_status_check CHECK (
    status IN (
      'queued',
      'fetching',
      'analyzing',
      'awaiting_approval',
      'importing',
      'completed',
      'failed'
    )
  ),
  CONSTRAINT business_media_import_jobs_source_payload_check CHECK (
    (
      source_type = 'website'
      AND requested_url IS NOT NULL
      AND social_connection_id IS NULL
    )
    OR (
      source_type IN ('instagram', 'facebook')
      AND social_connection_id IS NOT NULL
    )
  ),
  CONSTRAINT business_media_import_jobs_counts_check CHECK (
    pages_scanned >= 0
    AND candidate_count >= 0
    AND approved_count >= 0
    AND approved_count <= candidate_count
  ),
  CONSTRAINT business_media_import_jobs_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT business_media_import_jobs_completed_after_started_check CHECK (
    completed_at IS NULL
    OR started_at IS NULL
    OR completed_at >= started_at
  )
);

CREATE INDEX IF NOT EXISTS idx_business_media_import_jobs_business_status
  ON public.business_media_import_jobs(business_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_media_import_jobs_social_connection
  ON public.business_media_import_jobs(social_connection_id, created_at DESC)
  WHERE social_connection_id IS NOT NULL;

ALTER TABLE public.business_media_import_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.business_media_import_jobs FROM anon, authenticated;

GRANT SELECT ON public.business_media_import_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.business_media_import_jobs TO service_role;

DROP POLICY IF EXISTS "Owners can read their media import jobs" ON public.business_media_import_jobs;
CREATE POLICY "Owners can read their media import jobs"
ON public.business_media_import_jobs FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = business_media_import_jobs.business_id
      AND b.owner_id = auth.uid()
  )
);

COMMENT ON TABLE public.business_media_import_jobs IS
  'Observable, retryable discovery/import job state for website, Instagram, and Facebook media candidates.';
COMMENT ON COLUMN public.business_media_import_jobs.social_connection_id IS
  'References owner-authorized social account metadata only; OAuth tokens remain outside this table.';

COMMIT;
