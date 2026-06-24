# ADR-0057: Cluster Guardian uses a concrete nonprod namespace allowlist

- **Status:** Superseded by ADR-0059
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** Superseded by ADR-0059

## Context

`cluster-guardian` and `cluster-remediator` read `cluster_guardian.allowed_namespaces`
from `.github/factory.yml` as the authoritative namespace scope for compliant
cluster access. The prior config still used literal `<NAMESPACE_PREFIX>-dev` and
`<NAMESPACE_PREFIX>-test` placeholders even though `ops.namespace_prefix` was
already set to `10x-stack`.

Because the factory config is committed static YAML and the guardian tooling
does not resolve placeholders at runtime, the placeholder values did not define
real namespaces the guardian could inspect. That blocked namespace-scoped
discovery despite the repository already declaring a Kubernetes deployment
profile and namespace-scoped RBAC posture.

## Decision

We store the Cluster Guardian allowlist as explicit concrete nonprod namespace
names in `.github/factory.yml`:

- `10x-stack-dev`
- `10x-stack-test`

These values must stay aligned with `ops.namespace_prefix` and the actual
nonproduction namespaces the guardian is permitted to inspect.

## Consequences

- Cluster Guardian and Cluster Remediator now read a real namespace allowlist
  instead of unresolved placeholders, so namespace-scoped discovery is
  enforceable.
- The shared guardrail test can verify the allowlist against
  `ops.namespace_prefix`, making drift visible in CI.
- The allowlist remains duplicated static configuration; if the namespace prefix
  changes, this list must be updated in the same PR.

**Rollback:** If the intended nonprod namespaces change, update
`cluster_guardian.allowed_namespaces` back to the correct concrete namespace
values and keep the test aligned. Do not roll back to placeholder strings. If
the repository later adds supported runtime templating for namespace expansion,
record that as a superseding ADR and replace this explicit list then.

## Alternatives considered

- Keep placeholder values in `allowed_namespaces`: rejected because the guardian
  tooling reads this list literally, so placeholders do not authorize any real
  namespace.
- Derive the allowlist dynamically at runtime: rejected for now because the
  current control-plane contract is committed static YAML with no runtime
  namespace templating mechanism in the shared tooling.

## Evidence

- `.github/factory.yml` — `cluster_guardian.allowed_namespaces`,
  `ops.namespace_prefix`
- `.github/tools/shared/src/__tests__/cluster-guardian-foundation.test.ts` —
  guardrail that asserts the allowlist matches `ops.namespace_prefix`
- `.github/agents/cluster-guardian.agent.md` — scheduled agent reads the
  configured allowlist as its namespace scope
- `.github/agents/cluster-remediator.agent.md` — remediation agent uses the
  same allowlist contract
- `docs/adrs/0017-namespace-scoped-deploy-rbac.md` — namespace-scoped RBAC
  posture that this allowlist must honor
