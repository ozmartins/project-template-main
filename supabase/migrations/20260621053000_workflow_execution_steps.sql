-- Main now creates workflow_execution_steps in 20260621000000.
-- Keep this migration additive by applying least-privilege grant hardening only.
revoke insert, update, delete on workflow_execution_steps from authenticated;
revoke all on workflow_execution_steps from anon;
