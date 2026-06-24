# ADR-0055: create_entity_with_version gets a reset-path CI gate

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot
- **Supersedes / Superseded by:** —

## Context
The `create_entity_with_version` SECURITY DEFINER RPC was merged with direct-Postgres contract coverage and browser navigation coverage, but without the repository-standard Supabase reset-path validation. That left one important failure mode untested: the RPC and its authenticated role guard could still regress when all migrations are replayed from scratch by the Supabase CLI, even if targeted SQL assertions passed against a throwaway Postgres container.

This repository already treats fresh-apply safety as a control-plane requirement for database features, especially for auth-sensitive write paths. The missing gate needs to reuse the existing SQL contract assertions so the same admin/editor-only semantics are proven after `supabase db reset`, not just after manual migration replay.

## Decision
We add a dedicated PR-validation job for `create_entity_with_version` that runs `supabase db reset --config supabase/config.toml` and then executes `supabase/tests/rpc_create_entity_with_version.sql` against the reset database.

The existing direct-DB RPC guard job remains in place; the new gate complements it by covering the full Supabase reset/apply path rather than replacing the faster contract check.

## Consequences
Fresh-apply regressions in the RPC definition or its role-guard migration are now caught automatically before merge. The job also documents, in executable form, that the same SQL contract file is the source of truth for both direct-DB and reset-path enforcement.

The trade-off is one additional Supabase CLI job in PR validation, which adds runtime and consumes Docker resources. That cost is acceptable because this RPC is an authenticated write path and the missing coverage already caused a follow-up QA ticket.

## Alternatives considered
Rely only on the existing `run_direct_db_write_rpc_guards.sh` job. Rejected because it does not exercise the actual `supabase db reset` path called out by the testing strategy and issue acceptance criteria.

Treat the reset validation as a manual PR checklist item instead of a gate. Rejected because the repository already standardises reset-path verification as an automated CI responsibility for migration-backed features.

## Evidence
- `.github/workflows/pr-validation.yml`
- `supabase/tests/run_create_entity_with_version_reset.sh`
- `supabase/tests/rpc_create_entity_with_version.sql`
- `docs/adrs/0039-supabase-reset-path-ci-gates.md`
