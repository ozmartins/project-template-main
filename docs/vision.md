---
type: Vision
title: Project Vision and Principles
description: The eight founding principles that govern every architectural and process decision in this repository.
tags: [vision, principles, architecture, ai-native, kubernetes, open-source]
timestamp: 2026-06-22T00:00:00Z
---

## Project Vision and Principles

### 1. Template-first

This repository exists to be forked and reused by teams that need a reliable starting point. Every architectural decision must be understandable and reproducible by a new team with no prior project context. If a capability cannot be packaged as a reusable template component, it should not be part of this repository.

### 2. AI-native development

The factory pipeline is a first-class architectural component, not a convenience layer. Agents have defined roles, produce auditable outputs, and operate inside governed workflows. Human developers set direction, while agents execute and review within those boundaries.

### 3. Open source foundations

Vendor lock-in and per-seat licensing cost are explicit constraints in project decisions. Prefer software with strong open-source governance over proprietary services when operational overhead is acceptable. The stack must remain self-hostable so teams can retain control of their runtime and data.

### 4. Kubernetes as the universal runtime

From local development to cloud environments, the same deployment model should operate consistently. Environment-specific deployment logic is a defect, not a feature to preserve. Local and production systems should share the same runtime substrate to minimize drift.

### 5. Opt-in complexity

A fresh clone should be runnable by a developer in under 30 minutes. Production hardening is additive and activated through explicit configuration rather than required by default. Advanced controls must never become a prerequisite for getting the system running.

### 6. Multi-cloud by default

AWS and Azure are equal first-class deployment targets in this template. Any decision that introduces cloud-specific lock-in requires explicit ADR justification. The system must stay portable without requiring re-architecture.

### 7. Policy and security as code

Security controls, authorization rules, and compliance gates must be version-controlled artifacts. They should be testable and peer-reviewed with the same rigor as application code. Manual security gates and undocumented rules are defects that must be eliminated.

### 8. GitOps as the deployment truth

The repository is the authoritative source of desired system state. Any running system that diverges from repository state is in an error condition, not an accepted variation. Operational correctness depends on reconciling runtime state back to version-controlled intent.
