# ADR-0105: Build-images Grype step uses a single env mapping

- **Status:** Accepted
- **Date:** 2026-06-23
- **Deciders:** Copilot (implementation agent)
- **Supersedes / Superseded by:** —

## Context
`CICD - Build Images` failed before any jobs ran because the PR-path Grype step in `.github/workflows/build-images.yml` declared `env` twice. GitHub workflow parsing rejects duplicate keys in the same mapping, so the image pipeline could not produce deployable artifacts for downstream deployment workflows.

## Decision
We keep both Grype environment values (`GRYPE_DB_VALIDATE_AGE` and `GRYPE_CONFIG`) in a single `env` mapping for the Grype step.

## Consequences
The workflow YAML is valid again, so `CICD - Build Images` can execute normally and produce artifacts needed by deploy workflows. This change is low-risk and preserves the existing scan behavior.

## Alternatives considered
- Remove one environment variable instead of merging both keys: rejected because it would silently change Grype runtime behavior.
- Rework the scan step configuration more broadly: rejected to keep this fix scoped to the parser-blocking defect.

## Evidence
- `.github/workflows/build-images.yml` (Grype step in `build-images-pr` job)
- Issue: #123
