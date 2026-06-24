# ADR-0079: Canonical Issue Format and Dual-Enforcement via Forms and Agent Prompts

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Copilot (implementation), @ianreay (review)
- **Supersedes / Superseded by:** —

## Context

Factory agents filed issues inconsistently — different section names, missing Acceptance Criteria, missing Out of Scope, freeform titles — because the canonical ticket format existed only as informal convention with no enforcement mechanism. Human-authored issues submitted through the GitHub UI faced the same problem: blank-issue submission was allowed and no template guided contributors toward the required structure.

The factory depends on well-structured tickets for automated routing, implementation, and review. An inconsistently formatted ticket requires human triage overhead, breaks downstream automation that parses section content, and makes the Acceptance Criteria unverifiable.

## Decision

We establish `doc_templates/ISSUE.md` as the single authoritative prose standard for all human-authored and architect-authored tickets (`feat`, `fix`, `test`, `docs`, `chore`). Enforcement is applied at two points:

1. **GitHub UI (human-authored issues):** `.github/ISSUE_TEMPLATE/` provides four files — `feature.yml`, `bug.yml`, `test-gap.yml`, and `config.yml` (which sets `blank_issues_enabled: false`) — that enforce the canonical sections and required fields at creation time via GitHub's issue form rendering.

2. **Agent prompts (agent-authored issues):** The five factory agents that file issues (`docs-improver`, `audit-findings-triage`, `factory-process-reviewer`, `qa-manager`, `trend-analyst`) each receive an explicit canonical-format instruction block in their agent markdown files, referencing `doc_templates/ISSUE.md` as the contract.

`auto:ops` and `auto:alert` incident tickets remain **exempt** from this format. Those tickets are intentionally terse: a fingerprint line, evidence, and a run link. Requiring prose Summary, Context, and AC on an auto-generated incident ticket would reduce signal, not increase it.

## Consequences

- All new human-authored issues opened via GitHub UI are structurally constrained to canonical sections; blank issues are blocked.
- All new agent-authored issues must follow canonical sections or the agent prompt is non-conformant.
- `doc_templates/ISSUE.md` becomes a maintained contract — changes to required sections must update the agent prompts and issue forms in the same PR.
- `auto:ops` / `auto:alert` incident format is explicitly carved out, preventing over-standardisation of operational noise tickets.

## Alternatives considered

- **Prose-only policy in CONTRIBUTING.md.** Rejected because it requires every author to read and remember the policy. Templates enforce the structure without requiring prior knowledge.
- **Lint-based issue format validation via GitHub Actions.** Considered but deferred — requires issue body parsing automation that adds maintenance cost; form-level and prompt-level enforcement is sufficient for current factory scale.
- **Single shared template for all types.** Rejected because `feat`, `fix`, and `test` have meaningfully different spec sections (What to Build / Root Cause / What's Missing) that would be noise in a shared form.

## Evidence

- `doc_templates/ISSUE.md` — canonical prose standard
- `.github/ISSUE_TEMPLATE/feature.yml`, `bug.yml`, `test-gap.yml`, `config.yml` — UI enforcement
- `.github/agents/docs-improver.agent.md`, `audit-findings-triage.agent.md`, `factory-process-reviewer.agent.md`, `qa-manager.agent.md`, `trend-analyst.agent.md` — agent prompt enforcement
