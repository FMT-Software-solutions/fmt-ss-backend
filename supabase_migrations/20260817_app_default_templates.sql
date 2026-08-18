-- Canonical per-app defaults (MAIN project)
-- Run this in the main FMT Supabase project's SQL editor.
--
-- Today a new organization's defaults come from two hardcoded places that
-- drift apart from the app itself:
--   * DEFAULT_BRAND_COLORS inside each create-organization-owner edge function
--   * seed_* trigger functions inside each product project
-- When the app's expectations change and those are not updated, newly
-- provisioned organizations break.
--
-- This table is the single place the admin console treats as correct. It is
-- applied over an organization right after provisioning, and can be re-applied
-- to repair an existing organization that has drifted.

CREATE TABLE IF NOT EXISTS public.app_default_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id     text NOT NULL,          -- registry id: print-calc-pro, stockflow, churchhub-360
  kind       text NOT NULL CHECK (kind IN ('branding', 'roles', 'organization_settings')),
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes      text,
  is_active  boolean NOT NULL DEFAULT true,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, kind)
);

CREATE INDEX IF NOT EXISTS app_default_templates_app_idx
  ON public.app_default_templates (app_id, is_active);

-- Service-role only: the backend reads and writes this, never the browser.
ALTER TABLE public.app_default_templates ENABLE ROW LEVEL SECURITY;
