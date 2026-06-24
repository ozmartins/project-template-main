# ADR-0042: OpenBao + External Secrets Operator for secrets management

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay
- **Supersedes / Superseded by:** none

## Context

Kubernetes `Secret` objects store values as base64, not encrypted. Without envelope encryption configured at the etcd level (which we do not control on the managed cluster), any principal with `get secret` access to a namespace can read all secrets in cleartext. Additionally, there is no audit log of secret reads, no secret rotation mechanism, and no way to revoke a compromised value without manually cycling every Deployment that uses it.

We evaluated HashiCorp Vault but it is BSL-licensed since 2023 (non-open-source). We need a solution that is:
- Genuinely open source (OSI-approved licence)
- Operator-managed (runs inside the cluster, no external vendor dependency)
- Compatible with the existing Kubernetes-native workflow
- Already proven in the adjacent `mna-app` project at `deploy/openbao/`

## Decision

We use **OpenBao** (MPL-2.0, community fork of HashiCorp Vault) as the secrets store, and **External Secrets Operator** (Apache 2.0) as the Kubernetes controller that syncs secrets from OpenBao into native Kubernetes `Secret` objects consumed by pods.

Pods never mount OpenBao tokens directly. All secret delivery goes through ESO `ExternalSecret` resources, which are namespace-scoped and auditable.

## Consequences

**Easier:**
- Full audit log of every secret read via OpenBao's audit backend
- Secret rotation: update the value in OpenBao; ESO reconciles the Kubernetes Secret within the refresh interval — no pod restart required for most cases
- Revocation: disabling a Vault path immediately stops ESO from syncing it
- Licence compliance: MPL-2.0 is compatible with our allowed-licence policy (ADR-0025 equivalent)
- Pattern is already proven in `mna-app`; config templates exist at `deploy/openbao/`

**Harder:**
- Additional cluster component to operate (OpenBao HA Raft cluster, 3 replicas)
- Bootstrap requires a one-time unseal ceremony and platform-admin access
- Dev environment needs a dev-mode OpenBao instance or a different secret source (e.g. ESO with a `fake` provider, or a `.env` file for local Compose)
- CI/CD secrets (GitHub Actions `secrets.*`) remain outside OpenBao — only runtime Kubernetes secrets move here

**New obligations:**
- OpenBao snapshot cron job for disaster recovery (`deploy/openbao/snapshot-cronjob.yaml` pattern from `mna-app`)
- Cluster-admin bootstrap path required for initial install (not the namespace-scoped `gha-deployer`)
- Kubernetes auth roles must be created per namespace per environment

## Alternatives considered

| Option | Reason rejected |
|---|---|
| **HashiCorp Vault** | BSL licence since Aug 2023 — not open source; SSPL/BSL on our forbidden list (ADR licence policy) |
| **Sealed Secrets (Bitnami)** | Encrypts secrets at rest in git — good for GitOps but no audit log, no dynamic rotation, controller holds a single cluster key (single point of failure) |
| **SOPS + age/GPG** | File-level encryption for GitOps; no runtime secret injection, no Kubernetes-native delivery, no audit trail |
| **Infisical** | Open core — some features require paid plan; younger project, smaller operator ecosystem |
| **Doppler** | SaaS-only; vendor dependency, data leaves cluster |
| **Azure Key Vault + CSI driver** | Vendor lock-in to Azure; not portable; requires Azure Workload Identity configuration we don't fully control |

## Evidence

- `mna-app` reference implementation: `deploy/openbao/` (values-ha.yaml, secretstore-prod-template.yaml, snapshot-cronjob.yaml, networkpolicy.yaml, certificate.yaml)
- ESO `SecretStore` pattern: `deploy/openbao/secretstore-prod-template.yaml` in `mna-app`
- Implementation tracked in: issue #39 (project-template)
- OpenBao Helm chart: `helm repo add openbao https://openbao.github.io/openbao-helm`
- External Secrets Operator: https://external-secrets.io (Apache 2.0)
- OpenBao: https://openbao.org (MPL-2.0)
