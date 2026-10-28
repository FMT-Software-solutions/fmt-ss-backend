-- Discount codes for website orders (MAIN project)
-- Run this in the main FMT Supabase project's SQL editor.
--
-- Codes used to live in Sanity, whose dataset is publicly readable, so any
-- code could be listed by anyone. They live here instead, managed from the
-- admin console and applied only by the backend when it prices an order.
--
-- A redemption is written when an order is paid, so limits count real uses.
--
-- Service-role only: the backend reads and writes these, never the browser.

CREATE TABLE IF NOT EXISTS public.discount_codes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text NOT NULL,
  description          text,
  value_type           text NOT NULL CHECK (value_type IN ('percent', 'fixed')),
  value                numeric(12,2) NOT NULL CHECK (value > 0),
  -- Sanity premiumApp ids it applies to; empty = every app.
  app_ids              text[] NOT NULL DEFAULT '{}',
  min_total            numeric(12,2),                -- order subtotal needed
  max_discount         numeric(12,2),                -- cap for percent codes
  starts_at            timestamptz,
  ends_at              timestamptz,
  max_uses             int CHECK (max_uses > 0),     -- across all customers
  per_customer_limit   int NOT NULL DEFAULT 1 CHECK (per_customer_limit > 0),
  first_purchase_only  boolean NOT NULL DEFAULT false,
  is_active            boolean NOT NULL DEFAULT true,
  created_by           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (value_type <> 'percent' OR value <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS discount_codes_code_key ON public.discount_codes (upper(code));

CREATE TABLE IF NOT EXISTS public.discount_redemptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discount_code_id uuid NOT NULL REFERENCES public.discount_codes(id) ON DELETE CASCADE,
  purchase_id      uuid REFERENCES public.purchases(id) ON DELETE SET NULL,
  organization_id  uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  email            text NOT NULL,
  amount           numeric(12,2) NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purchase_id)
);

CREATE INDEX IF NOT EXISTS discount_redemptions_code_idx ON public.discount_redemptions (discount_code_id);
CREATE INDEX IF NOT EXISTS discount_redemptions_email_idx ON public.discount_redemptions (discount_code_id, lower(email));

ALTER TABLE public.discount_codes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_redemptions ENABLE ROW LEVEL SECURITY;
