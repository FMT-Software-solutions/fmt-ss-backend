-- Allow a "services" default template (MAIN project)
-- Run this in the main FMT Supabase project's SQL editor.
--
-- Print Suite Pro seeds each new organization with a service catalogue
-- (service_categories + services). Adding it here lets the catalogue be
-- captured from a known-good organization, reviewed, and re-applied to any
-- organization whose seeding did not run.

ALTER TABLE public.app_default_templates
  DROP CONSTRAINT IF EXISTS app_default_templates_kind_check;

ALTER TABLE public.app_default_templates
  ADD CONSTRAINT app_default_templates_kind_check
  CHECK (kind IN ('branding', 'roles', 'organization_settings', 'services'));
