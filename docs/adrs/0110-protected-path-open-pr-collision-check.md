# ADR-0110: Copilot checks protected paths for open PR collisions

- **Status:** Accepted
- **Date:** 2026-06-23
- **Deciders:** Factory Process Reviewer
- **Supersedes / Superseded by:** None

## Context

The nightly process review found PR #1016 blocked after platform review because PR #1022 already modified the same protected chart test path, `charts/app/ci-test.sh`, with a fuller anti-affinity matrix. Existing Copilot instructions required same-path collision checks only for protected workflow files, leaving chart, Terraform, deployment, and other protected paths without the same explicit preflight.

## Decision

We extend the existing open-PR same-path collision check in `.github/copilot-instructions.md` from protected workflow files to all protected and sensitive paths.

## Consequences

Copilot must stop and comment when another open PR already owns a protected or sensitive file path, reducing live shared-file drift and avoidable review round-trips. The check remains targeted to protected paths so ordinary application files are not blocked by an overly broad queue policy.

## Alternatives considered

Leaving the workflow-only rule unchanged was rejected because the observed collision happened in `charts/app/ci-test.sh`, outside `.github/workflows/**`. Adding a repository-wide same-file collision rule was rejected because it would over-constrain normal feature development and create unnecessary handoffs for low-risk application files.

## Evidence

- `.github/copilot-instructions.md`
- PR #1016 platform review cited a live shared-file drift collision with PR #1022 on `charts/app/ci-test.sh`.
