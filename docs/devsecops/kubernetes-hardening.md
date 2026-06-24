# Kubernetes hardening

This guide lets DevSecOps reviewers validate the template's Kubernetes hardening posture from repository evidence before Helm or manifest changes reach a cluster.

## Scope and evidence

Review these files together:

- [`terraform/modules/app-instance/namespaces.tf`](../../terraform/modules/app-instance/namespaces.tf)
- [`deploy/k8s/namespaces.yaml`](../../deploy/k8s/namespaces.yaml)
- [`deploy/k8s/rbac-nonprod.yaml`](../../deploy/k8s/rbac-nonprod.yaml)
- [`deploy/k8s/rbac-dev-db-bootstrap.yaml`](../../deploy/k8s/rbac-dev-db-bootstrap.yaml)
- [`charts/app/templates/networkpolicies.yaml`](../../charts/app/templates/networkpolicies.yaml)
- [`charts/app/templates/hpa.yaml`](../../charts/app/templates/hpa.yaml)
- [`charts/app/templates/pdb.yaml`](../../charts/app/templates/pdb.yaml)
- [`charts/app/values.yaml`](../../charts/app/values.yaml)
- [`charts/app/ci-test.sh`](../../charts/app/ci-test.sh)
- [`docs/adrs/0017-namespace-scoped-deploy-rbac.md`](../adrs/0017-namespace-scoped-deploy-rbac.md)

## Namespace isolation model

The template uses namespace boundaries as the first hardening layer.

| Path | Namespaces | Operational meaning | What reviewers should protect |
|---|---|---|---|
| [`terraform/modules/app-instance/namespaces.tf`](../../terraform/modules/app-instance/namespaces.tf) | `app`, `supabase`, `vault` namespaces per app instance | Terraform creates separate namespaces for application workloads, the in-cluster Supabase release, and the app-specific OpenBao/Vault deployment. | Reject changes that collapse these concerns into one namespace or add cross-namespace mutation without explicit design approval. |
| [`deploy/k8s/namespaces.yaml`](../../deploy/k8s/namespaces.yaml) | `10x-stack-dev`, `10x-stack-test`, `10x-stack-supabase` | Concrete non-prod layout for the shared staging cluster: dev and test app workloads stay isolated from each other, while Supabase runs in its own shared namespace. | Reject changes that deploy app workloads directly into the Supabase namespace or reuse unrelated namespaces. |

### Review interpretation

- App workloads belong in an environment-specific app namespace.
- Supabase gets its own namespace because it carries different credentials, network paths, and bootstrap workflows.
- Terraform also provisions a dedicated vault namespace for the app instance, keeping secret-management infrastructure out of the application namespace.
- Namespace creation is a setup-time concern. Automated deploy identities are intentionally scoped to operate inside an existing namespace, not create or mutate the whole cluster.

Least-privilege drift to flag in PR review:

- New workloads placed in `10x-stack-supabase` or the vault namespace without a clear control-plane reason.
- Cross-namespace `RoleBinding` or service-account reuse that lets one environment act in another.
- Any move from namespace-scoped resources to cluster-scoped resources without an ADR.

## RBAC model

### `gha-deployer`: namespace-scoped release identity

The non-prod release path uses a `gha-deployer` service account plus a namespace-scoped `Role` and `RoleBinding` in [`deploy/k8s/rbac-nonprod.yaml`](../../deploy/k8s/rbac-nonprod.yaml). The Terraform module mirrors the same intent in [`terraform/modules/app-instance/namespaces.tf`](../../terraform/modules/app-instance/namespaces.tf).

Allowed actions stay inside one namespace and cover only release-time objects:

- workloads: `deployments`, `replicasets`
- service plumbing: `services`, `ingresses`, `configmaps`
- diagnostics: `pods`, `pods/log`, `events`
- release-owned secrets/config: `secrets`, `externalsecrets`
- reliability controls: `poddisruptionbudgets`, `horizontalpodautoscalers`

The Terraform module (`namespaces.tf`) also grants the `gha-deployer` role `serviceaccounts` read/write within the app namespace, which the manifest-based `rbac-nonprod.yaml` does not include. Reviewers should treat the Terraform path as the authoritative definition for Terraform-managed clusters.

Security intent:

- the binding is a `RoleBinding`, not a `ClusterRoleBinding`
- permissions are namespaced, not cluster-wide
- the identity can deploy and troubleshoot workloads in its namespace, but it cannot create namespaces, install CRDs, or mutate other namespaces

Reviewers should treat any new cluster-scoped RBAC, wildcard resource access, or cross-namespace verbs as privilege creep unless the PR includes an approved design change.

### Service account token secrets

[`terraform/modules/app-instance/namespaces.tf`](../../terraform/modules/app-instance/namespaces.tf) creates long-lived `kubernetes.io/service-account-token` secrets for two identities:

- `gha-deployer-token` — consumed by [`.github/workflows/deploy-dev.yml`](../../.github/workflows/deploy-dev.yml) and [`.github/workflows/deploy-test.yml`](../../.github/workflows/deploy-test.yml) via the `KUBE_CONFIG_DEV` / `KUBE_CONFIG_TEST` GitHub Actions secrets
- `db-bootstrap-token` — consumed by [`.github/workflows/deploy-dev.yml`](../../.github/workflows/deploy-dev.yml) via the `KUBE_CONFIG_DEV_DB_BOOTSTRAP` GitHub Actions secret for the bootstrap runner path

Security implications reviewers should note:

- Long-lived tokens do not expire automatically. A leaked token retains the service account's permissions until the secret is rotated or deleted.
- Each token's blast radius is bounded by the namespace-scoped `Role` it is bound to; neither token grants cluster-wide access.
- To rotate a token: delete the `kubernetes_secret` resource in Terraform (`terraform destroy -target=...`) then re-apply to regenerate it (`terraform apply`), extract the new token value, and update the corresponding GitHub Actions secret (`KUBE_CONFIG_DEV`, `KUBE_CONFIG_TEST`, or `KUBE_CONFIG_DEV_DB_BOOTSTRAP`). No automated rotation pipeline is currently configured.
- Any PR that widens the `Role` permissions for either service account directly widens what a leaked token can do.

### DB bootstrap: separation of duties

[`deploy/k8s/rbac-dev-db-bootstrap.yaml`](../../deploy/k8s/rbac-dev-db-bootstrap.yaml) splits DB bootstrap responsibilities in the `10x-stack-supabase` namespace:

- GitHub-side bootstrap identity: `gha-db-bootstrap` in the manifest template, and `db-bootstrap-runner` in the Terraform module
- in-cluster execution identity: `db-bootstrap`

The split is deliberate:

| Identity | What it can do | What it should not do |
|---|---|---|
| GitHub runner bootstrap identity | Create/watch/delete the bootstrap `Job`, manage the bootstrap `ConfigMap`, read pod logs, and resolve the service account used by the job | It should not get broad application deploy rights or cluster-wide privileges. |
| In-cluster `db-bootstrap` identity | Resolve the DB pod and execute SQL work through `pods/exec`; read pod logs and list configmaps. The Terraform module also grants read access to `secrets` in the supabase namespace, which the manifest-based `rbac-dev-db-bootstrap.yaml` does not include. | It should not create jobs, create configmaps, or manage unrelated workloads. |

This split keeps the GitHub runner from gaining direct in-pod execution powers and keeps the in-cluster job from gaining orchestration powers over Kubernetes resources.

### Workload service accounts

[`terraform/modules/app-instance/namespaces.tf`](../../terraform/modules/app-instance/namespaces.tf) also pre-provisions three Helm-owned workload service accounts in the app namespace:

- `frontend` — pre-created by Terraform and annotated for Helm adoption (`meta.helm.sh/release-name`, `meta.helm.sh/release-namespace`)
- `temporal-worker` — same Terraform-pre-create/Helm-adopt pattern
- `ops-api` — same Terraform-pre-create/Helm-adopt pattern

These service accounts carry no permissions at Terraform provisioning time. Their only purpose is to ensure the service account objects exist in the namespace before Helm renders its workloads, avoiding a timing dependency where Helm both creates and immediately uses the same object. Helm's release annotations on the service accounts mean Helm owns their lifecycle after the first deploy.

Reviewers should flag any PR that:

- Adds `Role` or `ClusterRole` bindings to `frontend`, `temporal-worker`, or `ops-api` service accounts without a concrete, documented access need
- Annotates these service accounts with IRSA or Workload Identity bindings without an accompanying ADR explaining the cloud-permissions scope
- Removes the Helm adoption annotations, which would cause Helm to recreate the service account and potentially lose Terraform-managed labels

## NetworkPolicy posture

[`charts/app/templates/networkpolicies.yaml`](../../charts/app/templates/networkpolicies.yaml) establishes a default-deny posture for the application namespace when `networkPolicy.enabled` is true. [`charts/app/values.yaml`](../../charts/app/values.yaml) enables it by default.

Rendered policy shape:

1. `default-deny-all` applies to every pod in the namespace for both ingress and egress.
2. `frontend-policy`:
   - allows ingress only from the configured ingress-controller namespace
   - allows egress only for DNS (`53/TCP`, `53/UDP`)
3. `temporal-worker-policy`:
   - allows no ingress
   - allows egress only to DNS plus TCP `8000`, `443`, and `7233`
4. `ops-api-policy`:
   - allows no ingress
   - allows egress only to DNS plus TCP `8000`, `443`, and `7233`

Operationally, reviewers should expect new traffic paths to be explicit. If a workload needs a new dependency, the PR should add the narrowest possible allowlist rule and explain the port/protocol requirement.

Important caveat: Kubernetes enforces these policies only when the cluster CNI supports `NetworkPolicy`. See [`docs/architecture/network-security.md`](../architecture/network-security.md) for the enforcement caveat and supported-CNI reminder.

## Pod security baseline in the chart

[`charts/app/values.yaml`](../../charts/app/values.yaml) defines the baseline for `frontend`, `temporalWorker`, and `opsApi` pods.

Pod-level controls:

- `runAsNonRoot: true`
- numeric non-root identity: `runAsUser: 10001`, `runAsGroup: 10001`
- `seccompProfile.type: RuntimeDefault`

Container-level controls:

- `allowPrivilegeEscalation: false`
- `readOnlyRootFilesystem: true`
- `capabilities.drop: [ALL]`

Resource floor and ceiling controls:

- each component declares CPU, memory, and ephemeral-storage requests
- each component also declares CPU, memory, and ephemeral-storage limits

Reviewers should treat removal or weakening of any of these defaults as a security-significant change, especially if a PR:

- switches back to root
- adds Linux capabilities
- re-enables writable root filesystems
- removes resource limits/requests without a concrete operational reason

## HPA and PDB fail-closed safeguards

The chart does not rely on reviewers spotting bad values by eye; it rejects unsafe combinations during render.

### HPA checks

[`charts/app/templates/hpa.yaml`](../../charts/app/templates/hpa.yaml) fails chart rendering when either of these is true:

- `hpa.frontend.minReplicas > hpa.frontend.maxReplicas`
- `hpa.temporalWorker.minReplicas > hpa.temporalWorker.maxReplicas`

### PDB checks

[`charts/app/templates/pdb.yaml`](../../charts/app/templates/pdb.yaml) fails chart rendering when:

- `pdb.frontend.minAvailable` exceeds the frontend minimum replica count
- `pdb.temporalWorker.minAvailable` exceeds the temporal worker minimum replica count
- `pdb.opsApi.minAvailable` exceeds `opsApi.replicaCount`

For frontend and temporal worker, the effective minimum comes from `hpa.*.minReplicas` when HPA is enabled; otherwise it falls back to static `replicaCount`.

### Where this fails closed

- `helm template` fails immediately on invalid values
- `bash charts/app/ci-test.sh` asserts these failure modes in CI

That means a PR which proposes an unsafe HPA/PDB combination should fail before deployment, not after it reaches a cluster.

## Review checklist for Kubernetes or Helm changes

Use this checklist for any PR touching namespaces, RBAC, NetworkPolicy, HPA, PDB, or pod security settings.

### Namespaces

- [ ] Does the change keep app, Supabase, and vault/shared concerns separated by namespace?
- [ ] Does it avoid moving workloads into `10x-stack-supabase` unless the workload is part of the Supabase/bootstrap path?
- [ ] Does it avoid new cluster-scoped namespace mutation in the normal deploy path?

### RBAC

- [ ] Are deploy identities still bound with `Role`/`RoleBinding`, not `ClusterRole`/`ClusterRoleBinding`?
- [ ] Are new verbs/resources limited to a concrete release or bootstrap need?
- [ ] Does the DB bootstrap path preserve separation between the GitHub runner identity and the in-cluster `db-bootstrap` identity?
- [ ] Is there any wildcard (`*`) access, cross-namespace mutation, or privilege reuse that weakens least privilege?
- [ ] Do the `frontend`, `temporal-worker`, and `ops-api` workload service accounts remain free of `Role`/`ClusterRole` bindings unless a concrete, ADR-documented need exists?
- [ ] If IRSA or Workload Identity annotations are added to workload service accounts, is the cloud-permissions scope documented in an ADR?

### NetworkPolicy

- [ ] Does a default-deny posture remain in place for the app namespace?
- [ ] Are any new ingress or egress exceptions narrow, named, and justified by the workload's dependency path?
- [ ] If ports changed, were the chart templates and `charts/app/ci-test.sh` updated together?
- [ ] Does the PR avoid broad allow-all rules as a shortcut?

### Pod security and resources

- [ ] Do pods still run as non-root with numeric UID/GID?
- [ ] Does `RuntimeDefault` seccomp remain enabled?
- [ ] Are dropped capabilities, `allowPrivilegeEscalation: false`, and read-only root filesystems preserved?
- [ ] Do requests and limits remain defined for CPU, memory, and ephemeral storage?

### Reliability safeguards

- [ ] If HPA values changed, do `minReplicas` and `maxReplicas` still satisfy the template guardrails?
- [ ] If PDB values changed, do `minAvailable` values stay at or below the effective minimum replicas?
- [ ] If a new autoscaled workload was introduced, did the PR add equivalent render-time validation instead of relying on convention?

## What weakens the hardening posture

Escalate review when a PR introduces any of the following without explicit design approval:

- cluster-wide RBAC for deploy or bootstrap paths
- namespace sharing between unrelated concerns
- missing or weakened `NetworkPolicy` defaults
- broader traffic allowlists without a concrete dependency reason
- removal of non-root, seccomp, dropped-capability, or read-only-root defaults
- HPA/PDB changes that bypass template validation or CI contract tests
