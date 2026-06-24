# ADR-0087: Board Steward canonical hierarchy and flat epic routing

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** Copilot (implementation), @ianreay (review)
- **Supersedes / Superseded by:** —

## Context

The Board Steward prompt is a maintained control-plane contract under `.github/agents/`. This refactor tightened the prompt by removing repeated hierarchy definitions and replacing mixed routing prose with a flat label-to-epic mapping.

Repository policy requires an in-PR ADR for control-plane contract changes under `.github/**`, even when behavior is preserved.

## Decision

We define the `Canonical hierarchy` table as the single source of truth for initiative/epic IDs and default phase values. We route orphan issues through the flat `Label → Epic mapping` table by alias, and when no label matches we fall back to `EPIC_CI`.

## Consequences

- Board-steward hierarchy IDs and default phase assignments stay single-sourced in one section.
- Orphan routing remains deterministic and auditable via explicit label-to-alias rows.
- Unmatched issues continue to be triaged consistently using the `EPIC_CI` default.

## Alternatives considered

- **Keep duplicated hierarchy definitions and mixed fallback prose.** Rejected because repeated IDs and distributed fallback rules increase drift risk.
- **Introduce keyword heuristics outside the mapping table.** Rejected because it hides routing behavior and weakens reviewability.
- **Skip ADR coverage for a prompt-only refactor.** Rejected because `.github/**` control-plane contracts require same-PR ADR documentation in this repository.

## Evidence

- `.github/agents/board-steward.agent.md` — canonical hierarchy table, flat label mapping, and fallback rule (`EPIC_CI`)
- `docs/adrs/README.md` — ADR-0087 index entry
