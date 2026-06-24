# ADR-0082: Add SQL, YAML, and Markdown lint gates to PR validation

- **Status:** Accepted
- **Date:** 2026-06-21
- **Deciders:** Ian Reay, Copilot coding agent
- **Supersedes / Superseded by:** —

## Context

Issue `#37` asks for automated quality gates beyond the existing TypeScript and
Helm checks. Today, SQL migration style/syntax drift is only caught when
Supabase reset-path jobs run, workflow YAML mistakes are only partially covered
by Helm rendering, and Markdown formatting regressions are untracked.

This change updates `.github/workflows/pr-validation.yml`, which is a
control-plane boundary and therefore requires an in-PR ADR.

Raw `yamllint` cannot parse Helm Go-template files under `charts/**/templates/`.
Those files are already covered by the existing Helm lint/render validation job,
so the YAML gate needs a narrower static-YAML scope.

## Decision

We add three read-only PR-validation jobs:

- `sql-migrations` installs `sqlfluff==4.2.0` and lints `supabase/migrations/`
  using a repo-root `.sqlfluff` config.
- `yaml-files` installs `yamllint==1.37.1` and lints `.github/workflows/` plus
  chart YAML with a repo-root `.yamllint.yml` config that ignores Helm template
  directories and treats legacy line-length noise as warnings.
- `markdown-docs` runs `markdownlint-cli2@0.16.0` against `docs/**/*.md` and
  `README.md` using a repo-root `.markdownlint.yaml` config.

All three jobs are added to `validation-summary` so the Summary gate fails when
any of the new lint gates fail.

## Consequences

- SQL migrations now get a fast parser/style gate before deeper Supabase tests.
- Workflow YAML receives a dedicated read-only syntax/style check, while Helm
  templates remain validated by the existing Helm render job instead of raw
  YAML parsing.
- Documentation regressions now have a Markdown gate, but several legacy
  formatting rules remain explicitly disabled until the docs corpus is cleaned
  up in follow-up work.
- The lint tooling versions are pinned in workflow commands, and the new
  checkout steps use full commit SHAs with read-only permissions.

## Alternatives considered

- Put all three linters into one PR-validation job: rejected because issue #37
  asks for the three gates to appear independently in `validation-summary`.
- Run `yamllint` directly on `charts/**/templates/**`: rejected because Helm
  template directives are not valid standalone YAML and the repository already
  has a dedicated Helm render validation path.
- Use third-party wrapper actions for YAML/Markdown linting: rejected because
  pinned CLI installs keep the jobs read-only and avoid introducing extra
  mutable action references.

## Evidence

- `.github/workflows/pr-validation.yml`
- `.github/workflows/WORKFLOWS.md`
- `.sqlfluff`
- `.yamllint.yml`
- `.markdownlint.yaml`
- `temporal/tests/pr_validation_lint_contract.test.ts`
- Issue: `#37`
