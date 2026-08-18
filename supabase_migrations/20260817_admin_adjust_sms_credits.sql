-- Admin SMS credit adjustment
--
-- RUN THIS IN EACH PRODUCT PROJECT (not the main one):
--   Church Hub 360, Stock Flow, Print Suite Pro.
-- The SMS tables are identical across all three, so this file is the same
-- everywhere.
--
-- Why a new function rather than reusing add_sms_credits():
--   * add_sms_credits() rejects anything <= 0, so it cannot correct a mistake.
--   * It records every grant as type 'purchase', which would inflate SMS
--     revenue reporting with goodwill credits that no one paid for.
-- This records grants as 'bonus' and deductions as 'usage', and stamps the
-- acting admin into metadata so adjustments are traceable in the ledger.

CREATE OR REPLACE FUNCTION public.admin_adjust_sms_credits(
  p_org_id   uuid,
  p_delta    integer,          -- positive grants credits, negative removes them
  p_reason   text,
  p_actor    text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_previous_balance integer;
  v_new_balance      integer;
BEGIN
  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'p_delta must be a non-zero integer';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'p_reason is required for an admin adjustment';
  END IF;

  SELECT credit_balance INTO v_previous_balance
  FROM public.organization_sms_balances
  WHERE organization_id = p_org_id
  FOR UPDATE;

  -- Balance floors at zero, matching how deduct_sms_credits treats overdraft.
  INSERT INTO public.organization_sms_balances (organization_id, credit_balance)
  VALUES (p_org_id, GREATEST(p_delta, 0))
  ON CONFLICT (organization_id) DO UPDATE
    SET credit_balance = GREATEST(public.organization_sms_balances.credit_balance + p_delta, 0),
        updated_at = now()
  RETURNING credit_balance INTO v_new_balance;

  INSERT INTO public.sms_credit_transactions (organization_id, type, amount, description, metadata)
  VALUES (
    p_org_id,
    CASE WHEN p_delta > 0 THEN 'bonus' ELSE 'usage' END,
    p_delta,
    btrim(p_reason),
    COALESCE(p_metadata, '{}'::jsonb)
      || jsonb_build_object(
           'admin_adjustment', true,
           'actor', p_actor,
           'previous_balance', COALESCE(v_previous_balance, 0)
         )
  );

  RETURN jsonb_build_object(
    'success', true,
    'previous_balance', COALESCE(v_previous_balance, 0),
    'new_balance', v_new_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_sms_credits(uuid, integer, text, text, jsonb) FROM public, anon, authenticated;
