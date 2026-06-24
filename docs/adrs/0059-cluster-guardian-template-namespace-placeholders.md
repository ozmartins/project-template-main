# ADR-0059: Cluster Guardian allowlist uses template namespace placeholders

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** Supersedes ADR-0057

## Context

Shared tools contract tests validate this repository as a reusable template.  
Those tests expect `cluster_guardian.allowed_namespaces` in `.github/factory.yml`
to remain placeholder-based (`<NAMESPACE_PREFIX>-dev`, `<NAMESPACE_PREFIX>-test`)
so downstream repositories can substitute their own namespace prefix.

A prior change switched the allowlist to concrete `10x-stack-*` values, which
broke the template contract expected by shared regression tests.

## Decision

We keep `cluster_guardian.allowed_namespaces` in `.github/factory.yml` as:

- `<NAMESPACE_PREFIX>-dev`
- `<NAMESPACE_PREFIX>-test`

for template portability and contract compatibility.

## Consequences

- Shared template contract tests remain aligned with repository intent.
- Forks can configure their own namespace prefix without editing multiple control-plane files.
- Cluster guardian namespace scope remains declarative, but values are template placeholders rather than concrete runtime names in this repository.

## Alternatives considered

- Keep concrete `10x-stack-dev` / `10x-stack-test`: rejected because this repository is a template and the shared contract requires placeholders.

## Evidence

- `.github/factory.yml` — `cluster_guardian.allowed_namespaces`
- `.github/tools/shared/src/__tests__/cluster-guardian-foundation.test.ts` — namespace placeholder contract assertion
- PR #236 — requested regression fix and ADR inclusion for `.github/**` change
