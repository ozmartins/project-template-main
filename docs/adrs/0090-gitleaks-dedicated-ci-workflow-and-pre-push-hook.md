# ADR-0090: Dedicated Gitleaks CI Workflow and Pre-Push Local Hook

- **Status:** Accepted
- **Date:** 2026-06-22
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

GitHub's built-in secret scanning only detects secrets introduced in new pushes to the default branch. The repository already had a `pre-commit` hook (`gitleaks detect --staged`) via lefthook and an allowlist in `.gitleaks.toml`, and gitleaks ran nightly as part of `code-quality.yml`. However:

1. No dedicated PR/push gating workflow existed — the nightly run is non-gating by design (ADR-0072) and does not block merges.
2. The local hook was `pre-commit`-only, making it easy to bypass with `git push --no-verify` on an already-committed secret.
3. Secret detection was bundled into quality flows rather than isolated as a first-class security gate visible in pull request checks.

This created a gap: a secret committed with `--no-verify` could reach GitHub without any CI gate firing before merge.

## Decision

We add a **dedicated `.github/workflows/gitleaks.yml`** that gates every PR and every push to `main`, pinned to an immutable action SHA, with `permissions: contents: read` only. We extend `lefthook.yml` with a **`pre-push` hook** (`gitleaks protect --staged --redact`) as a defence-in-depth local gate before push reaches GitHub.

The two local hooks have intentionally distinct scopes:

| Hook | Command | When | Purpose |
|---|---|---|---|
| `pre-commit` | `gitleaks detect --staged` | Before commit is written | Immediate feedback on staged content |
| `pre-push` | `gitleaks protect --staged --redact` | Before commits reach remote | Last-resort gate with output redaction |

The CI workflow scans only the PR/push delta via `gitleaks-action@v2.3.9` (SHA-pinned per ADR-0080). The existing `.gitleaks.toml` allowlist is reused unchanged — no new allowlist entries are required, because a full scan of the repository confirmed that no false positives exist in the current `docs/` tree under the default Gitleaks ruleset.

## Consequences

- Every PR now has a visible `Gitleaks secret scan` check that must pass before merge.
- Pushes to `main` (e.g., merge commits) are also scanned — catching any secrets that slipped past pre-commit hooks with `--no-verify`.
- The `pre-push` hook provides a second local barrier, reducing the frequency of CI failures due to accidental secret inclusion.
- Developers must have `gitleaks` installed locally (`brew install gitleaks`; also installed by `make setup`).
- Future false positives in `docs/` (e.g., example connection strings) should be suppressed via narrowly scoped `regexes` entries in `.gitleaks.toml`, not path-level bypasses, to keep full coverage of the docs tree.

## Alternatives considered

- **Expand the nightly `code-quality.yml` scan to gate PRs:** Rejected — nightly scans are deliberately non-gating (ADR-0072) and mixing gating/non-gating responsibilities in one workflow creates confusion and review complexity.
- **Use only the `pre-commit` hook:** Rejected — `pre-commit` can be bypassed with `--no-verify` and provides no CI safety net.
- **Use `GITLEAKS_LICENSE` for commercial features:** Not required — audit mode (no license key) is sufficient for detecting and failing on secrets.

## Evidence

- `.github/workflows/gitleaks.yml` — the dedicated CI gate added by this ADR
- `lefthook.yml` — `pre-push.commands.gitleaks` section added by this ADR
- `.gitleaks.toml` — no new entries required; existing allowlist unchanged
- Issue: Volaris-AI/project-template#23
- ADR-0041 (pre-commit hook strategy), ADR-0072 (nightly code-quality workflow), ADR-0080 (action SHA pinning)
