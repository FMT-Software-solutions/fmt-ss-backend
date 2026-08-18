-- SMS low-balance alert log (MAIN project)
-- Run this in the main FMT Supabase project's SQL editor.
--
-- Records every low-balance alert so the daily sweep does not message the same
-- organization every morning. Also gives a history of who was warned and what
-- their balance was at the time.

CREATE TABLE IF NOT EXISTS public.sms_balance_alerts (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_type       text NOT NULL CHECK (alert_type IN ('org_low_balance', 'main_low_balance')),
  app_id           text,
  organization_id  uuid,
  organization_name text,
  recipient        text,
  balance_at_alert numeric,
  threshold        numeric,
  channel          text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms', 'email')),
  triggered_by     text NOT NULL DEFAULT 'cron' CHECK (triggered_by IN ('cron', 'admin')),
  succeeded        boolean NOT NULL DEFAULT true,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sms_balance_alerts_lookup_idx
  ON public.sms_balance_alerts (app_id, organization_id, alert_type, created_at DESC);
CREATE INDEX IF NOT EXISTS sms_balance_alerts_created_at_idx
  ON public.sms_balance_alerts (created_at DESC);

-- Service-role only.
ALTER TABLE public.sms_balance_alerts ENABLE ROW LEVEL SECURITY;
