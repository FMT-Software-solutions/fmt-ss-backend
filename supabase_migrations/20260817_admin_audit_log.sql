-- Admin audit log (MAIN project)
-- Run this in the main FMT Supabase project's SQL editor.
--
-- Every write the admin console makes against a customer's data is recorded
-- here: who did it, to which app and organization, and what changed. Credits
-- and trial status are money-adjacent, so "who granted this org 500 credits
-- and why" needs an answer.

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id        uuid,
  actor_email     text,
  action          text NOT NULL,
  app_id          text,
  organization_id uuid,
  target_id       text,
  summary         text,
  details         jsonb DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx
  ON public.admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_org_idx
  ON public.admin_audit_log (app_id, organization_id, created_at DESC);

-- Service-role only: the backend writes and reads this, never the browser.
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
