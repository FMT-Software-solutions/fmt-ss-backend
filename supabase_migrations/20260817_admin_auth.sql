-- Admin authentication support (MAIN project)
-- Run this in the main FMT Supabase project's SQL editor.

-- 1. OTP request tracking for the admin forgot-password flow.
--    Service-role only: RLS enabled with no policies.
CREATE TABLE IF NOT EXISTS public.admin_otp_requests (
  email text PRIMARY KEY,
  requests_count integer NOT NULL DEFAULT 0,
  last_request_at timestamptz
);

ALTER TABLE public.admin_otp_requests ENABLE ROW LEVEL SECURITY;

-- 2. Tighten quotes RLS. The old policy granted SELECT to ANY authenticated
--    user; now that admins sign in with Supabase Auth on this project, that
--    would let every future authenticated user read all quotes. Admin reads
--    go through the backend's service-role client instead.
DROP POLICY IF EXISTS "Authenticated users can view quotes" ON public.quotes;

-- 3. Admin account creation (manual, run per admin):
--    a) Create the user in Authentication > Users (email + password), then:
--    b) UPDATE auth.users
--         SET raw_app_meta_data = raw_app_meta_data || '{"fmt_admin": true}'::jsonb
--       WHERE email = 'admin@example.com';
