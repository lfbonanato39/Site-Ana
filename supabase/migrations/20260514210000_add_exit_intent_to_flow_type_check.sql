-- =========================================================================
-- Migration: add 'exit_intent' to whatsapp_intents.flow_type CHECK constraint
-- Date:      2026-05-14
-- Entrega:   2.3 (exit-intent → /api/leads)
-- Author:    Luiz Felipe (com Claude Opus 4.7)
-- =========================================================================
--
-- CONTEXT
-- -------
-- The Entrega 2.3 wired the exit-intent submit to /api/leads, which performs
-- two sequential inserts: first into `public.leads`, then into
-- `public.whatsapp_intents`. Both carry flow_type='exit_intent'.
--
-- The leads insert succeeded (lead UUID cbcf02e3-8bf6-4414-86d1-137da0c22e5e
-- was created on the Vercel Preview), but the whatsapp_intents insert failed
-- with PostgreSQL error code 23514:
--
--   new row for relation "whatsapp_intents" violates check constraint
--   "whatsapp_intents_flow_type_check"
--
-- Reason: whatsapp_intents has a CHECK constraint on flow_type that accepts
-- only ('mini_landing', 'pre_form'). The leads table has no equivalent
-- constraint — that's why the leads insert went through and the intents one
-- did not.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- DROP the old constraint and recreate it accepting three values:
--   'pre_form'     — submit do modal grande de qualificação
--   'mini_landing' — submit do modal curto disparado por [data-wa-direct]
--   'exit_intent'  — submit do popup de saída (NEW)
--
-- Wrapped in a transaction so the DROP is rolled back if the ADD fails.
--
-- PRE-FLIGHT VERIFICATION (already run on 2026-05-14)
-- ----------------------------------------------------
-- SELECT 'whatsapp_intents' AS tbl, flow_type, COUNT(*) AS n
-- FROM public.whatsapp_intents GROUP BY flow_type;
-- → whatsapp_intents | mini_landing | 3
-- → whatsapp_intents | pre_form     | 1
-- All existing values are in the new whitelist — migration applies cleanly.
--
-- ROLLBACK (if needed)
-- --------------------
-- BEGIN;
--   ALTER TABLE public.whatsapp_intents
--     DROP CONSTRAINT IF EXISTS whatsapp_intents_flow_type_check;
--   ALTER TABLE public.whatsapp_intents
--     ADD CONSTRAINT whatsapp_intents_flow_type_check
--     CHECK (flow_type = ANY (ARRAY['mini_landing'::text, 'pre_form'::text]));
-- COMMIT;
-- =========================================================================

BEGIN;

ALTER TABLE public.whatsapp_intents
  DROP CONSTRAINT IF EXISTS whatsapp_intents_flow_type_check;

ALTER TABLE public.whatsapp_intents
  ADD CONSTRAINT whatsapp_intents_flow_type_check
  CHECK (flow_type = ANY (ARRAY['pre_form'::text, 'mini_landing'::text, 'exit_intent'::text]));

COMMIT;
