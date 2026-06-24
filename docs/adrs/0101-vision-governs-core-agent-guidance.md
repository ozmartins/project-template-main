# ADR-0101: Make `docs/vision.md` the canonical reference for core agent guidance

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** Ian Reay
- **Supersedes / Superseded by:** none

## Context

This PR introduces `docs/vision.md` and updates core agent-facing instruction surfaces so vision principles are consulted before implementation work. One of those changes is under `.github/copilot-instructions.md`, which is a control-plane contract boundary in this repository and requires a same-PR ADR.

Without an explicit ADR, future instruction edits can drift away from a single governing source and reviewers have no canonical baseline for enforcing consistency across guidance surfaces.

## Decision

We designate `docs/vision.md` as the canonical governing reference for core agent guidance. Core instruction surfaces must direct agents to read the vision first, and any conflicting implementation-level decision must be documented via an ADR.

## Consequences

- Core guidance in `README.md`, `AGENTS.md`, and `.github/copilot-instructions.md` now aligns on one durable source of truth.
- Reviewer enforcement becomes straightforward: guidance changes that conflict with vision principles require an explicit ADR trail.
- Future edits to agent guidance must preserve the “vision first” contract or deliberately supersede this ADR.

## Alternatives considered

- **Keep guidance distributed without a canonical source:** rejected because it increases interpretation drift and weakens review consistency.
- **Only link vision from README, not control-plane guidance:** rejected because control-plane instructions are where implementation behavior is governed.

## Evidence

- `docs/vision.md`
- `README.md` (`## Vision` section)
- `AGENTS.md` (vision listed first in references)
- `.github/copilot-instructions.md` (`## Vision` section)
