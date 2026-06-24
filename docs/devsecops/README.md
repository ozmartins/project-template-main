# DevSecOps Documentation

Operational guides for DevSecOps practitioners — security engineers, platform engineers, and on-call operators responsible for security posture, compliance, infrastructure operations, and incident response on this stack.

> **Note:** This folder is populated by the `devsecops-docs-manager` agent, which runs nightly via
> [`pipeline-nightly-devsecops-docs.yml`](../../.github/workflows/pipeline-nightly-devsecops-docs.yml).
> On the first run against an empty folder the agent enters bootstrap mode and files tickets covering all
> major security and operations areas. Copilot then implements each ticket. Trigger the workflow manually
> to bootstrap coverage on a fresh fork.

These guides are written from an **operations and security lens** — every guide answers "what do I check, run, or configure?" not "how do I build a feature?" For developer how-to guides, see [`docs/developer/`](../developer/README.md).

## Guides

| Area | Guide | Who reads it |
|---|---|---|
| Security controls | [security-controls.md](security-controls.md) | Security engineers auditing active gates; CI/CD reviewers |
| Audit & compliance | [`audit-and-compliance.md`](./audit-and-compliance.md) | Compliance officers, security engineers running/reading CIS Kubernetes, Azure benchmark, and architecture audits |
| Secrets management | [`secrets-management.md`](./secrets-management.md) | Platform engineers managing OpenBao, ESO, and GitHub Actions secrets; incident responders |
| Network security | [Network security guide](./network-security.md) | Network/platform engineers reviewing ingress topology, WAF policy, and NetworkPolicy rules |
| Kubernetes hardening | [Kubernetes hardening](./kubernetes-hardening.md) | Platform engineers reviewing namespace isolation, RBAC, pod security, and HPA/PDB posture |
| Terraform & IaC | *(ticket pending)* | Platform/security engineers reviewing IaC changes and state security |
| Dependency & patch management | *(ticket pending)* | Security engineers managing Dependabot, OSV findings, and patch SLAs |
| Access control & identity | *(ticket pending)* | IAM reviewers, security engineers auditing Supabase RLS, IRSA, and CODEOWNERS |
| Incident response | *(ticket pending)* | On-call operators, SREs responding to `auto:ops`, `auto:alert`, and `auto:cluster` issues |
| Environment & promotion | *(ticket pending)* | Release engineers, security reviewers approving prod promotions |
| Container security | *(ticket pending)* | Security engineers reviewing image build pipeline, tagging, and supply chain |

Links update as Copilot implements each ticket.

## Relationship to other docs

| If you need… | Go to… |
|---|---|
| How to build a feature or run the stack locally | [`docs/developer/`](../developer/README.md) |
| How end users operate the system | [`docs/user-guide/`](../user-guide/README.md) |
| Architecture decisions and rationale | [`docs/adrs/`](../adrs/README.md) |
| Network security architecture deep-dive | [`docs/architecture/network-security.md`](../architecture/network-security.md) |
| Security vulnerability reporting | [`.github/SECURITY.md`](../../.github/SECURITY.md) |
| Active audit workflows | [`.github/workflows/WORKFLOWS.md`](../../.github/workflows/WORKFLOWS.md) |
