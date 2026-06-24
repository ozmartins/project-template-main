# ADR-0058: deploy-dev workflow uses concrete namespace values

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

After `ops.namespace_prefix` was set to `10x-stack` and
`cluster_guardian.allowed_namespaces` was populated with concrete values in
`.github/factory.yml` (see ADR-0057), the deploy-dev workflow still carried
literal `<DEV_NAMESPACE>` placeholder strings in:

- The workflow `name:` comment header and the `PHASE2-DEPLOYMENT.md` reference comment
- The deploy job's `name:` display label (`Deploy app to <DEV_NAMESPACE>`)
- The Helm upgrade step's `name:` label (`Helm upgrade (<DEV_NAMESPACE>)`)
- The `SUPABASE_NAMESPACE` env-var fallback (`|| '<SUPABASE_NAMESPACE>'`)

These placeholders were harmless at runtime because the actual `$DEV_NAMESPACE`
value came from a repository variable (`vars.DEV_NAMESPACE`). However, the
`SUPABASE_NAMESPACE` fallback was silently inoperative — if `vars.SUPABASE_NAMESPACE`
was absent the fallback resolved to the literal string `<SUPABASE_NAMESPACE>`,
which is not a real namespace. The `ci-test.sh` contract tests and the
`phase2-k8s-deploy-foundation.test.ts` shared-tools tests also asserted these
placeholder strings directly, making both test suites placeholder-anchored rather
than value-anchored.

## Decision

We replace all `<DEV_NAMESPACE>`, `<TEST_NAMESPACE>`, and `<SUPABASE_NAMESPACE>`
placeholder literals in the deploy-dev workflow, Helm values files, and deploy
manifests with the configured concrete values derived from `ops.namespace_prefix`:

- `<DEV_NAMESPACE>` → `10x-stack-dev`
- `<TEST_NAMESPACE>` → `10x-stack-test`
- `<SUPABASE_NAMESPACE>` → `10x-stack-supabase`

The companion contract tests (`ci-test.sh`, `phase2-k8s-deploy-foundation.test.ts`)
are updated in the same PR to assert these concrete values, completing the alignment
started in ADR-0057.

## Consequences

- The `SUPABASE_NAMESPACE` fallback in the bootstrap-db job now resolves to the
  correct namespace (`10x-stack-supabase`) if the repository variable is absent,
  removing the silent no-op risk.
- Step and job display names in the workflow UI are human-readable rather than
  literal angle-bracket strings.
- Contract tests are anchored to the real configured values; any future namespace
  rename will cause the CI test gate to fail, making drift visible immediately.
- If the namespace prefix ever changes, `values-dev.yaml`, `values-test.yaml`,
  `deploy/k8s/namespaces.yaml`, `deploy/k8s/rbac-nonprod.yaml`,
  `deploy/k8s/rbac-dev-db-bootstrap.yaml`, `deploy-dev.yml`, `ci-test.sh`, and
  `phase2-k8s-deploy-foundation.test.ts` must all be updated together.

## Alternatives considered

- **Keep placeholder step names and only update test assertions to check real
  Helm output values:** Rejected because it leaves incoherent placeholder strings
  in the workflow YAML and leaves the `SUPABASE_NAMESPACE` fallback broken.
- **Use runtime variable substitution in step names:** Not supported by GitHub
  Actions for `name:` fields at the job/step level; step names are static YAML.

## Evidence

- `.github/factory.yml` — `ops.namespace_prefix: 10x-stack`,
  `cluster_guardian.allowed_namespaces: [10x-stack-dev, 10x-stack-test]`,
  `ops.supabase_namespace: 10x-stack-supabase`
- `.github/workflows/deploy-dev.yml` — updated step/job names and fallback
- `charts/app/values-dev.yaml`, `charts/app/values-test.yaml` — concrete namespace values
- `deploy/k8s/namespaces.yaml`, `deploy/k8s/rbac-nonprod.yaml`,
  `deploy/k8s/rbac-dev-db-bootstrap.yaml` — concrete namespace values
- `charts/app/ci-test.sh` — updated assertions
- `.github/tools/shared/src/__tests__/phase2-k8s-deploy-foundation.test.ts` — updated assertions
- `docs/adrs/0057-cluster-guardian-concrete-namespace-allowlist.md` — precursor decision
