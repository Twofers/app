BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_owner_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason_category text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent')),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_owner_communications_business_created_idx
  ON public.admin_owner_communications(business_id, created_at DESC);

ALTER TABLE public.admin_owner_communications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_owner_communications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_owner_communications_deny_clients ON public.admin_owner_communications;
CREATE POLICY admin_owner_communications_deny_clients
  ON public.admin_owner_communications
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (COALESCE(false, false))
  WITH CHECK (COALESCE(false, false));

REVOKE ALL ON public.admin_owner_communications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.admin_owner_communications TO service_role;

INSERT INTO public.admin_ai_prompts (
  prompt_name,
  feature,
  prompt_version,
  system_prompt,
  output_schema,
  is_active
)
VALUES (
  'owner_email',
  'owner_email',
  'admin-owner-email-v1',
  'Draft a concise support email from Twofer to a business owner using only the verified facts in the input. Never invent facts, offer performance, deadlines, billing outcomes, credits, refunds, approvals, or account changes. Never expose internal reason codes, tokens, secrets, customer information, provider output, or raw system state. Clearly state the observed issue, why resolving it helps, and one factual next step. Use a warm professional tone. Do not claim that an action has already happened. Return only strict JSON with subject and body.',
  '{"type":"object","additionalProperties":false,"required":["subject","body"],"properties":{"subject":{"type":"string","maxLength":160},"body":{"type":"string","maxLength":5000}}}'::jsonb,
  true
)
ON CONFLICT (prompt_name, prompt_version) DO NOTHING;

COMMIT;
