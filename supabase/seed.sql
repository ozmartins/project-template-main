-- Seed data for project-template.
-- BEGIN/COMMIT is required: SET LOCAL only works inside a transaction block.
-- Without it, Supabase CLI (which runs seed outside a transaction) emits WARNING 25P01.
BEGIN;

-- The service_role claim is required by the bootstrap pipeline for any write RPCs.
SET LOCAL request.jwt.claim.role = 'service_role';

-- Add project-specific seed data below.

COMMIT;
