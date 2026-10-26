-- Payment plans (MAIN project)
-- Run this in the main FMT Supabase project's SQL editor.
--
-- Customers who can't pay for an app at once ask for a plan; an admin creates
-- a private plan and sends the customer a link. The customer verifies with a
-- one-time code, pays the deposit (which provisions the app as paid) and then
-- pays what is due through the same link. Every payment adds to amount_paid;
-- what is due is derived from the schedule, so partial and early payments
-- need no special handling.
--
-- A plan more than grace_days behind is suspended (the app is locked) and is
-- reinstated as soon as the overdue amount is paid.
--
-- Service-role only: the backend reads and writes these, never the browser.

CREATE TABLE IF NOT EXISTS public.payment_plan_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id            text NOT NULL,
  app_title         text,
  contact           text NOT NULL,              -- email address or 233XXXXXXXXX
  contact_type      text NOT NULL CHECK (contact_type IN ('email', 'phone')),
  name              text,
  organization_name text,
  message           text,
  status            text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'planned', 'declined')),
  plan_id           uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_plan_requests_status_idx
  ON public.payment_plan_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.payment_plans (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         uuid REFERENCES public.payment_plan_requests(id) ON DELETE SET NULL,
  app_id             text NOT NULL,
  app_title          text NOT NULL,
  contact            text NOT NULL,
  contact_type       text NOT NULL CHECK (contact_type IN ('email', 'phone')),
  customer_name      text,
  organization_name  text,
  -- Set when the customer accepts; the FMT organization exists from the deposit on.
  billing_details    jsonb,
  organization_id    uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  base_price         numeric(12,2) NOT NULL CHECK (base_price > 0),
  surcharge_percent  numeric(5,2) NOT NULL DEFAULT 0 CHECK (surcharge_percent >= 0),
  total_amount       numeric(12,2) NOT NULL CHECK (total_amount > 0),
  amount_paid        numeric(12,2) NOT NULL DEFAULT 0,
  currency           text NOT NULL DEFAULT 'GHS',
  grace_days         int NOT NULL DEFAULT 7 CHECK (grace_days BETWEEN 0 AND 60),
  notes              text,
  status             text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'sent', 'active', 'suspended', 'completed', 'cancelled')),
  -- Identifies the plan in its link. Kept so reminders can carry the link; it
  -- grants nothing alone: the page needs a one-time code sent to the contact.
  link_token         text UNIQUE,
  link_sent_at       timestamptz,
  accepted_at        timestamptz,
  activated_at       timestamptz,
  suspended_at       timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_plans_status_idx
  ON public.payment_plans (status, created_at DESC);

-- Schedule. Instalment 0 is the deposit and is due on acceptance.
CREATE TABLE IF NOT EXISTS public.payment_plan_installments (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id   uuid NOT NULL REFERENCES public.payment_plans(id) ON DELETE CASCADE,
  seq       int NOT NULL CHECK (seq >= 0),
  due_date  date NOT NULL,
  amount    numeric(12,2) NOT NULL CHECK (amount > 0),
  UNIQUE (plan_id, seq)
);

CREATE TABLE IF NOT EXISTS public.payment_plan_payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id          uuid NOT NULL REFERENCES public.payment_plans(id) ON DELETE CASCADE,
  reference        text NOT NULL UNIQUE,
  provider         text NOT NULL CHECK (provider IN ('paystack', 'hubtel', 'manual')),
  amount           numeric(12,2) NOT NULL CHECK (amount > 0),  -- what was asked for
  amount_paid      numeric(12,2),                               -- what the provider confirmed
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  method           text,
  external_id      text,
  details          jsonb DEFAULT '{}'::jsonb,
  recorded_by      text,                                        -- admin email for manual payments
  created_at       timestamptz NOT NULL DEFAULT now(),
  confirmed_at     timestamptz
);

CREATE INDEX IF NOT EXISTS payment_plan_payments_plan_idx
  ON public.payment_plan_payments (plan_id, created_at DESC);

-- One-time codes and the short sessions they unlock on the customer page.
CREATE TABLE IF NOT EXISTS public.payment_plan_otps (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id             uuid NOT NULL REFERENCES public.payment_plans(id) ON DELETE CASCADE,
  code_hash           text NOT NULL,
  expires_at          timestamptz NOT NULL,
  attempts            int NOT NULL DEFAULT 0,
  verified_at         timestamptz,
  session_hash        text UNIQUE,
  session_expires_at  timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_plan_otps_plan_idx
  ON public.payment_plan_otps (plan_id, created_at DESC);

-- History: link sent, payments, reminders, suspensions. dedupe_key stops the
-- daily job sending the same reminder twice.
CREATE TABLE IF NOT EXISTS public.payment_plan_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id     uuid NOT NULL REFERENCES public.payment_plans(id) ON DELETE CASCADE,
  type        text NOT NULL,
  summary     text,
  details     jsonb DEFAULT '{}'::jsonb,
  dedupe_key  text,
  actor       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS payment_plan_events_plan_idx
  ON public.payment_plan_events (plan_id, created_at DESC);

-- Claims a pending payment exactly once and adds what was paid to the plan,
-- in one transaction. Returns the plan row as it is after the payment, or
-- nothing when the payment was already claimed.
CREATE OR REPLACE FUNCTION public.claim_payment_plan_payment(
  p_reference   text,
  p_amount_paid numeric,
  p_method      text,
  p_external_id text,
  p_details     jsonb
) RETURNS SETOF public.payment_plans
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id uuid;
BEGIN
  UPDATE payment_plan_payments
     SET status = 'completed',
         amount_paid = p_amount_paid,
         method = COALESCE(p_method, method),
         external_id = p_external_id,
         details = COALESCE(details, '{}'::jsonb) || COALESCE(p_details, '{}'::jsonb),
         confirmed_at = now()
   WHERE reference = p_reference
     AND status = 'pending'
  RETURNING plan_id INTO v_plan_id;

  IF v_plan_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE payment_plans
     SET amount_paid = amount_paid + p_amount_paid,
         updated_at = now()
   WHERE id = v_plan_id
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_payment_plan_payment(text, numeric, text, text, jsonb) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.payment_plan_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_plans             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_plan_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_plan_payments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_plan_otps         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_plan_events       ENABLE ROW LEVEL SECURITY;
