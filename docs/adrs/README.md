# Architecture Decision Records (ADRs)

This directory records the significant architectural decisions made on this project, **why** they were made, and what we traded away. ADRs are the reference point for reviews: when we evaluate a change, a spec, or a deploy, we check it against these records to confirm we are still making the right decisions — and we add or supersede a record when we make a new one.

## Why we keep these

Architectural decisions (data model, orchestration engine, deployment topology, external edge, auth boundaries) are easy to execute in code and impossible to review later if they were never written down. That is the failure mode these records exist to prevent: a review has nothing to check against if the decision was never articulated. Record the decision when you make it, not after something built on top of it breaks.

## Process

- **One decision per file**, named `NNNN-short-slug.md`, numbered sequentially.
- Use [`TEMPLATE.md`](./TEMPLATE.md). Keep each record short and concrete; cite **evidence** (commit hashes, PR numbers, file paths, live resource names).
- **Status** is one of: `Proposed` · `Accepted` · `Superseded by ADR-NNNN` · `Deprecated`.
- An ADR is **immutable once Accepted** — to change a decision, write a new ADR that supersedes it and update the old one's status. Do not silently rewrite history.
- **When to write one:** any decision that is costly to reverse, shapes more than one component, picks one technology/pattern over alternatives, or changes a security/data/deploy boundary. When in doubt, write it.
- **Who:** the Factory Architect owns ADR authorship for designs it produces; the Tech Reviewer should flag any PR that makes an architectural decision without a corresponding ADR (see the maintenance note at the bottom).

## Index

| ADR | Title | Status |
|---|---|---|
| **Temporal & Orchestration** |||
| [0001](./0001-temporal-workflow-dsl.md) | JSON DSL Interpreter for Configuration-Driven Temporal Workflows | Proposed |
| [0006](./0006-temporal-workflow-orchestration.md) | Temporal for Workflow Orchestration | Accepted |
| [0007](./0007-temporal-signal-driven-human-in-the-loop.md) | Signal-Driven Human-in-the-Loop Approval Gates | Accepted |
| [0008](./0008-llm-agent-tool-use-adapter.md) | LLM Agent Loop via Tool-Use Adapter | Accepted |
| [0055](./0055-shared-temporal-server-dev-namespace.md) | Dev Environment Uses Shared Temporal Server in `dev` Namespace | Accepted |
| [0106](./0106-workflow-launch-json-schema-contract.md) | Workflow launch payloads use a canonical top-level `input_schema` contract | Proposed |
| **GitHub Factory** |||
| [0002](./0002-github-factory-architecture.md) | GitHub as Autonomous Software Factory | Accepted |
| [0003](./0003-github-category-pipeline-organization.md) | GitHub Category Pipeline Organization | Accepted |
| [0004](./0004-github-workflows-available-activation-pattern.md) | GitHub Workflows-Available Activation Pattern | Accepted |
| [0005](./0005-github-pipeline-rename.md) | GitHub Pipeline Rename (cadence names → category prefixes) | Accepted |
| [0009](./0009-github-copilot-implements-sdk-agents-orchestrate.md) | GitHub Copilot Implements; SDK Agents Orchestrate | Accepted |
| [0010](./0010-github-runner-placement-policy.md) | GitHub Runner Placement Policy | Accepted |
| [0011](./0011-github-label-driven-work-routing.md) | GitHub Label-Driven Work-Routing Model | Accepted |
| [0053](./0053-copilot-ownership-uses-issue-assignees.md) | Copilot ownership uses GitHub issue assignees | Accepted |
| [0026](./0026-github-project-initiative-epic-story-hierarchy.md) | GitHub Project — Initiative → Epic → Story Hierarchy | Accepted |
| [0027](./0027-github-factory-reviewers-reach-terminal-decisions.md) | Factory Reviewers Reach Terminal Decisions In-Lane | Accepted |
| [0028](./0028-github-standing-architecture-audits.md) | Standing Architecture Audits and Behaviour-Over-Existence Review | Accepted |
| [0029](./0029-github-qa-slo-scorecard.md) | QA SLO Scorecard and Targets Framework | Accepted |
| [0030](./0030-github-non-gating-quality-ux-observability.md) | Non-Gating Quality and UX Observability Lanes | Accepted |
| [0032](./0032-github-pr-enrichment-least-privilege-token.md) | PR Enrichment Uses Minimal Pull-Request Token | Accepted |
| [0043](./0043-github-script-v9-for-control-plane-workflows.md) | Use actions/github-script v9 in control-plane workflows | Accepted |
| [0043](./0043-pr-dsl-definition-diff-comments.md) | PR DSL Definition Diff Summary Comments | Accepted |
| [0044](./0044-github-actions-control-plane-major-upgrades.md) | Control-plane Workflow Action Major-Version Upgrades Require In-PR ADRs | Accepted |
| [0045](./0045-build-images-buildx-v4.md) | Build Images workflow uses docker/setup-buildx-action v4 | Accepted |
| [0047](./0047-audit-scripts-typescript.md) | Convert audit scripts from Python to TypeScript | Accepted |
| [0049](./0049-docker-login-action-v4-control-plane-upgrade.md) | Use docker/login-action v4 in control-plane workflows | Accepted |
| [0052](./0052-upload-artifact-v7-control-plane-upgrade.md) | Use actions/upload-artifact v7 in control-plane workflows | Accepted |
| [0054](./0054-supabase-setup-cli-v2-control-plane-upgrade.md) | Use supabase/setup-cli v2 in control-plane workflows | Accepted |
| [0056](./0056-ci-history-artifact-path-contract.md) | Fix ci-history artifact path contract for unit and temporal suites | Accepted |
| [0057](./0057-cluster-guardian-concrete-namespace-allowlist.md) | Cluster Guardian uses a concrete nonprod namespace allowlist | Superseded by ADR-0059 |
| [0058](./0058-e2e-dev-env-sourced-config-and-skip-budget.md) | E2E dev workflow uses `dev` environment config and enforces skip budget | Accepted |
| [0058](./0058-deploy-dev-workflow-concrete-namespace-values.md) | deploy-dev workflow uses concrete namespace values | Accepted |
| [0059](./0059-cluster-guardian-template-namespace-placeholders.md) | Cluster Guardian allowlist uses template namespace placeholders | Accepted |
| [0059](./0059-temporal-dsl-stub-tests-in-pr-validation.md) | Run stub-based Temporal DSL tests in PR Validation | Accepted |
| [0062](./0062-workflow-name-standardisation.md) | Standardise GitHub Actions Workflow Display Names | Accepted |
| [0063](./0063-weekly-azure-front-door-cidr-refresh-workflow.md) | Weekly Azure Front Door CIDR refresh workflow | Accepted |
| [0064](./0064-cluster-guardian-preflight-skip-unconfigured-runners.md) | Cluster Guardian skips preflight on runners without cluster access | Accepted |
| [0066](./0066-ontology-lint-pr-gate.md) | Ontology lint as a PR gate for SQL migrations | Accepted |
| [0067](./0067-dev-branch-build-push-and-dev-latest-tags.md) | Dev branch push to ACR with dev-latest tags | Accepted |
| [0070](./0070-build-images-ecr-oidc-authentication.md) | Build images workflow uses GitHub OIDC for ECR authentication | Accepted |
| [0070](./0070-pipeline-daily-trend-analyst-stage.md) | Add trend-analyst stage to pipeline-daily | Accepted |
| [0071](./0071-e2e-dev-preflight-base-url-and-incident-token.md) | E2E dev workflow preflights base URL and uses github.token for incidents | Superseded by ADR-0098 |
| [0076](./0076-pipeline-weekly-personas-curator.md) | Weekly pipeline and personas-curator agent | Accepted |
| [0072](./0072-activate-nightly-code-quality-workflow.md) | Activate nightly code-quality workflow (CodeQL, Semgrep, Trivy, gitleaks, tsc, eslint, ruff) | Accepted |
| [0074](./0074-factory-process-reviewer-direct-instruction-maintenance.md) | Factory Process Reviewer may directly maintain Copilot instructions | Superseded by 0075 |
| [0075](./0075-factory-process-reviewer-write-scope-isolation.md) | Factory Process Reviewer isolates write scope to a dedicated daily job | Accepted |
| [0077](./0077-e2e-dev-skip-budget-results-file-guard.md) | E2E dev skip-budget checks require Playwright results output | Accepted |
| [0076](./0076-pipeline-weekly-diary-agent.md) | Weekly diary-agent pipeline | Accepted |
| [0079](./0079-canonical-issue-format-enforcement.md) | Canonical Issue Format and Dual-Enforcement via Forms and Agent Prompts | Accepted |
| [0080](./0080-osv-pr-diff-scan-gate.md) | OSV dependency review gate for PR lockfile changes | Accepted |
| [0085](./0085-pr-validation-frontend-coverage-gate.md) | PR validation frontend unit tests enforce coverage thresholds | Accepted |
| [0077](./0077-contract-drift-detector-daily-stage.md) | Daily contract drift detector for Supabase RPC and Temporal activity surfaces | Accepted |
| [0080](./0080-workflow-actions-pinned-to-commit-shas.md) | Pin workflow actions to immutable commit SHAs | Accepted |
| [0083](./0083-hadolint-dockerfile-lint-pr-gate.md) | Hadolint Dockerfile linting as a PR gate | Accepted |
| [0079](./0079-publish-status-branch.md) | Publish unified CI & environment status to a `status` branch | Accepted |
| [0080](./0080-personas-curator-prompt-maintenance.md) | Keep personas-curator prompt maintenance centralized and compact | Accepted |
| [0086](./0086-pr-handler-first-match-routing-table.md) | PR Handler uses a first-match routing table | Accepted |
| [0087](./0087-board-steward-canonical-hierarchy-and-flat-epic-routing.md) | Board Steward canonical hierarchy and flat epic routing | Accepted |
| [0088](./0088-qa-manager-prompt-contract-preservation.md) | QA-manager prompt compaction preserves evidence and scorecard contract | Accepted |
| [0102](./0102-build-images-pr-scan-tool-runtime-compatibility.md) | Build-images PR scan runtime compatibility for Dockle and Grype | Accepted |
| [0090](./0090-gitleaks-dedicated-ci-workflow-and-pre-push-hook.md) | Dedicated Gitleaks CI Workflow and Pre-Push Local Hook | Accepted |
| [0093](./0093-pr-validation-license-checker-allowlist-gate.md) | PR validation enforces npm license allowlist with license-checker | Accepted |
| [0098](./0098-gitleaks-action-v3-node24-runtime-upgrade.md) | Upgrade gitleaks/gitleaks-action from v2.3.9 to v3.0.0 (Node 24 runtime) | Accepted |
| [0091](./0091-nightly-developer-docs-coverage-pipeline.md) | Nightly developer-docs coverage pipeline and manager agent | Accepted |
| [0089](./0089-tech-reviewer-prompt-contract-preservation.md) | Tech-reviewer prompt compaction preserves review contract | Accepted |
| [0095](./0095-docs-improver-closed-issue-comment-guard.md) | docs-improver must check issue state before posting any comment | Accepted |
| [0103](./0103-gitleaks-pr-token-scope-and-secretless-pr-path.md) | Gitleaks PR scan uses pull-request read scope and secretless PR path | Accepted |
| [0104](./0104-workflow-history-engineering-health-dashboard.md) | Workflow-native engineering health dashboard on `main` | Accepted |
| [0105](./0105-build-images-grype-env-map-validity.md) | Build-images Grype step uses a single env mapping | Accepted |
| [0104](./0104-copilot-pr-trusted-rerun-backstop.md) | Trusted rerun backstop for same-repo Copilot PR workflow gates | Accepted |
| [0108](./0108-auto-rerun-action-required-same-repo-runs.md) | Maintainer-dispatched rerun of same-repo action_required workflow runs | Accepted |
| [0109](./0109-copilot-pre-existing-ci-comment-scope.md) | Copilot keeps PR comments scoped around pre-existing CI failures | Accepted |
| [0110](./0110-protected-path-open-pr-collision-check.md) | Copilot checks protected paths for open PR collisions | Accepted |
| [0111](./0111-build-images-pr-transient-network-tolerance.md) | Build-images PR path tolerates transient network/cache failures | Accepted |
| [0112](./0112-shared-ci-baseline-attribution.md) | Shared CI baseline-attribution step for factory reviewers and monitors | Accepted |
| [0113](./0113-copilot-pr-conflict-refresh-detection.md) | Copilot PR conflict-refresh detection stage in pipeline-fast | Accepted |
| [0114](./0114-copilot-cancelled-ci-guidance.md) | Copilot cancelled CI guidance | Accepted |
| [0115](./0115-factory-no-diff-reconciliation-gate.md) | Factory no-diff and already-satisfied Copilot PR guardrails | Accepted |
| [0116](./0116-actions-monitor-baseline-conclusion-alignment.md) | Align actions-monitor baseline attribution with shared failure-conclusion set | Accepted |
| [0117](./0117-factory-pr-coordination-gate.md) | Queue-level coordination gate for shared-path collisions, ADR-number reservations, and post-conflict scope checks | Proposed |
| [0118](./0118-dependency-update-scope-contract.md) | Canonical dependency lane model and diff envelope for Dependabot and Copilot update PRs | Proposed |
| [0121](./0121-build-images-attestation-soft-fail-for-private-org-billing.md) | Build-images native attestation step is non-blocking on private-org billing limits | Accepted |
| [0099](./0099-docs-improver-run-summary-credit-attribution.md) | docs-improver run summary records credit-attribution observations instead of issue comments | Accepted |
| [0095](./0095-docs-improver-closed-issue-comment-guard.md) | docs-improver closed-issue guard — check state before any write action | Accepted |
| [0092](./0092-nightly-azure-security-audit.md) | Nightly Azure Security Audit via Prowler and Microsoft Defender for Cloud | Accepted |
| [0092](./0092-container-image-vulnerability-scanning.md) | Container image vulnerability scanning in build-images workflow | Accepted |
| [0091](./0091-build-images-supply-chain-attestations.md) | Build images workflow signs digests and publishes provenance | Accepted |
| [0096](./0096-auto-deploy-fingerprint-normalisation-and-upsert.md) | auto:deploy fingerprint normalisation and pre-dedup upsert gate | Accepted |
| [0098](./0098-e2e-dev-graceful-skip-missing-base-url.md) | E2E dev workflow skips gracefully when `vars.E2E_BASE_URL` is unset | Accepted |
| [0100](./0100-pipeline-hourly-contents-write.md) | Isolate `contents: write` to factory-architect publish job in pipeline-hourly | Accepted |
| [0101](./0101-vision-governs-core-agent-guidance.md) | `docs/vision.md` is the canonical governing reference for core agent guidance | Accepted |
| [0126](./0126-e2e-skip-budget-relaxed-when-auth-absent.md) | E2E skip budget relaxed to 100% when auth credentials are absent | Accepted |
| [0120](./0120-e2e-dev-mfa-secret-export.md) | Export E2E_MFA_SECRET in e2e-dev workflow jobs for TOTP derivation | Accepted |

| [0070](./0070-build-images-ecr-oidc-authentication.md) | Build images workflow uses GitHub OIDC for ECR authentication | Accepted |
| **Deployment & Infrastructure** |||
| [0012](./0012-immutable-image-builds-digest-promotion.md) | Immutable Image Builds and Digest-Based Promotion | Accepted |
| [0013](./0013-helm-chart-environment-profiles.md) | Helm Chart with Per-Environment Value Profiles | Accepted |
| [0014](./0014-helm-manifest-validation-in-ci.md) | Helm Manifest Validation in CI | Accepted |
| [0015](./0015-self-hosted-supabase.md) | Self-Hosted Supabase as the Database and Auth Layer | Accepted |
| [0016](./0016-self-hosted-supabase-in-cluster.md) | Self-Host Supabase In-Cluster for Production | Accepted |
| [0017](./0017-namespace-scoped-deploy-rbac.md) | Namespace-Scoped RBAC for Deploy Runners | Accepted |
| [0033](./0033-kubernetes-deployment-portability.md) | Kubernetes Deployment Portability Across Cloud Providers and Self-Hosted | Accepted |
| [0065](./0065-helm-chart-hpa-pdb-controls.md) | Helm chart exposes HPA and PDB controls | Accepted |
| [0068](./0068-acr-pull-secret-provisioned-by-deploy-workflows.md) | ACR Pull Secret Provisioned as Idempotent Preflight in Deploy Workflows | Accepted |
| [0072](./0072-deploy-dev-externalsecret-rbac-handoff.md) | Deploy Dev fails fast on missing ExternalSecret RBAC | Accepted |
| [0078](./0078-terraform-gha-deployer-rbac-runtime-alignment.md) | Keep Terraform gha-deployer RBAC aligned with deploy runtime contract | Accepted |
| [0070](./0070-helm-kube-score-best-practice-scan.md) | Helm best-practice scan with kube-score in the architecture-audit workflow | Accepted |
| [0080](./0080-semgrep-pr-gate.md) | Semgrep SAST PR gate | Accepted |
| [0094](./0094-app-chart-networkpolicy-env-gated-rollout-and-allowlist.md) | App chart NetworkPolicy env-gated rollout and minimal allowlist | Accepted |
| [0092](./0092-workload-serviceaccounts-tokenless-by-default.md) | Workload ServiceAccounts with tokenless pod identities by default | Accepted |
| [0105](./0105-db-bootstrap-configmap-read-access.md) | db-bootstrap gets read-only ConfigMap access for in-cluster bootstrap | Accepted |
| [0107](./0107-opentelemetry-tempo-distributed-tracing.md) | OpenTelemetry + Tempo as the distributed tracing plane | Proposed |
| [0119](./0119-grafana-lgtm-observability-stack.md) | Opt-in Grafana OSS observability stack for metrics, logs, traces, dashboards, and alerts | Proposed |
| [0124](./0124-temporal-configmap-hook-policy-parity.md) | Temporal ConfigMap hook policy parity across AKS and EKS dev | Accepted |
| [0125](./0125-workflow-run-shell-context-env-indirection.md) | Workflow `run:` steps use env indirection for GitHub/context-derived shell values | Accepted |
| [0122](./0122-kube-score-incident-auto-close.md) | Auto-close kube-score incident issues on clean scan | Accepted |
| **Frontend** |||
| [0018](./0018-json-driven-ui-engine.md) | JSON-Driven UI Engine | Accepted |
| [0019](./0019-frontend-data-layer-tanstack-supabase.md) | Frontend Data Layer — TanStack Router + TanStack Query + Supabase PostgREST | Accepted |
| [0020](./0020-radix-ui-tailwind-component-library.md) | Radix UI + Tailwind CSS as the Component Foundation | Accepted |
| [0031](./0031-frontend-static-bundle-nginx-runtime-config.md) | Frontend Static Bundle with Nginx and Runtime Browser Config | Accepted |
| **Auth & Access Control** |||
| [0034](./0034-authentication-user-management-access-control.md) | Authentication, User Management, and Access Control | Accepted |
| [0035](./0035-role-based-ui-access-control.md) | Role-Based UI Access Control via useAuthCapabilities | Accepted |
| [0069](./0069-authenticated-workflow-triggers-read-only-by-default.md) | Authenticated workflow triggers are read-only by default | Accepted |
| **Database** |||
| [0021](./0021-core-entity-scd2-schema.md) | Core Entity + SCD2 Versioning Schema | Accepted |
| [0022](./0022-analytics-fact-types.md) | Analytics Layer — Fact Types and Time-Series Points | Accepted |
| [0023](./0023-authenticated-write-path-security-definer-rpc.md) | Authenticated Write Path via SECURITY DEFINER RPCs | Accepted |
| [0024](./0024-additive-migrations-only.md) | Additive-Only Database Migrations | Accepted |
| **Local Development** |||
| [0025](./0025-local-dev-supabase-cli-hybrid-compose.md) | Local Dev Stack — Supabase CLI + Docker Compose Hybrid | Accepted |
| **Testing** |||
| [0036](./0036-testing-strategy-and-pyramid.md) | Testing Strategy and Test Pyramid | Accepted |
| [0037](./0037-real-environment-e2e-playwright.md) | Real-Environment E2E Testing with Playwright | Accepted |
| [0038](./0038-environment-graduated-testing.md) | Environment-Graduated Testing Strategy (Dev / UAT / Production) | Accepted |
| [0039](./0039-supabase-reset-path-ci-gates.md) | Supabase Reset-Path CI Gates | Accepted |
| [0040](./0040-temporal-workflow-contract-tests.md) | Temporal Workflow Contract Tests | Accepted |
| [0046](./0046-pr-gate-dsl-definition-validation.md) | PR Gate for Temporal DSL Definition Validation | Accepted |
| [0055](./0055-create-entity-rpc-reset-path-gate.md) | create_entity_with_version gets a reset-path CI gate | Accepted |
| [0058](./0058-workflow-classifications-ci-gate.md) | workflow_classifications Reset-Path CI Gate | Accepted |
| [0064](./0064-temporal-dsl-stub-tests-ci-gate.md) | Temporal DSL stub tests CI gate | Accepted |
| [0082](./0082-pr-validation-extra-linters.md) | Add SQL, YAML, and Markdown lint gates to PR validation | Accepted |
| [0097](./0097-temporal-ci-json-output-fix.md) | Fix Temporal CI JSON Report Generation and Coverage Thresholds | Accepted |
| [0108](./0108-pr-validation-summary-gates-temporal-dsl-stub-job.md) | PR validation summary gates the Temporal DSL stub job | Accepted |

## Maintenance note

Keeping this index honest is the whole point. Factory policy enforcement:
- Tech Reviewer ADR-gate: a PR that adds/changes infra, swaps a library/service, introduces a new service, or changes a deploy/security/data boundary must link an ADR (or `docs/adrs/`) in the PR. If missing, request changes and add `needs-adr`.
- Factory Architect ADR authorship: when an architecture design/spec introduces or changes a decision, the Architect publishes the corresponding ADR(s) in `docs/adrs/` using `TEMPLATE.md`.
- Copilot implementation rule: when approved implementation changes introduce an architectural decision, include/update the ADR in `docs/adrs/` and reference it in the PR.
- Accepted ADRs are immutable. Changed decisions must be recorded via a new superseding ADR plus status/history updates to the prior ADR.
