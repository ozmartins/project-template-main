# ADR-0017: Namespace-Scoped RBAC for Deploy Runners

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

CI/CD pipelines that deploy to Kubernetes need cluster credentials. The simplest approach is a cluster-admin `kubeconfig`, but this grants the pipeline full control over the entire cluster — a compromised secret or a runaway automation can destroy any namespace, install arbitrary workloads, or exfiltrate secrets cluster-wide.

## Decision

Deploy runners operate with **namespace-scoped RBAC only**. Each environment (dev, test, prod) has a dedicated Kubernetes ServiceAccount bound to a Role (not ClusterRole) that grants exactly the permissions needed for Helm installs within that namespace:

```
verbs: [get, list, watch, create, update, patch, delete]
resources: [deployments, services, configmaps, secrets, pods, ingresses,
            persistentvolumeclaims, serviceaccounts]
namespace: <env-namespace>
```

The `kubeconfig` credentials used by CI are generated from this ServiceAccount token — not from an admin credential. A separate ServiceAccount is used for each environment so prod credentials do not grant dev access.

Cluster-level operations (namespace creation, ClusterRole binding, CRD installation) require a human operator with admin access — they are outside the deploy automation scope.

## Consequences

**Positive:**
- A compromised deploy secret is limited to one namespace. It cannot escalate to cluster-admin or access other namespaces.
- Principle of least privilege is enforced at the infrastructure layer, not just by policy.
- Different environments use different credentials — a prod deployment cannot accidentally reach the dev namespace.
- Audit logs (Kubernetes audit policy) show only the namespace-scoped operations for the deploy service account, making incident investigation cleaner.

**Negative:**
- Initial cluster setup requires a human with cluster-admin to create namespaces, ServiceAccounts, and RoleBindings. This is a one-time operation but must be documented.
- Some Helm charts install CRDs or ClusterRoles at install time. These must be pre-installed by a cluster admin or managed separately; they cannot be part of the automated deploy.
- If the application genuinely needs cross-namespace access at runtime (e.g., reading from a shared secrets namespace), the RoleBinding must be explicitly extended — this won't be obvious if the deploy succeeds but the app fails at runtime.

## Alternatives considered

**Cluster-admin `kubeconfig`:** Simple but dangerous. A single secret compromise gives full cluster control.

**OIDC-federated workload identity (GitHub OIDC → Kubernetes token):** Eliminates long-lived secrets; strongly preferred for production. This ADR establishes the RBAC scope regardless of credential mechanism. Workload identity can be layered on top.

**Separate CI clusters per environment:** Full isolation but high infrastructure cost and operational complexity for a template.

## Evidence

- `.github/factory.yml` — `cluster` namespace configuration per environment
- `charts/app/` — chart that runs within the scoped namespace
- ADR-0013 — per-environment Helm profiles that consume these credentials
