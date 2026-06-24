# Contributing

## 1. Before you start

This is a **template repository** — fork it to start your own project. Read the [quick-start in README.md](README.md#quick-start) first to get your local stack running.

Required reading before any code change:

- [README.md](README.md) — stack overview and local setup
- [AGENTS.md](AGENTS.md) — repository structure and module map
- [docs/adrs/README.md](docs/adrs/README.md) — why and how we record architectural decisions

## 2. Opening an issue

Open an issue when you have found a bug, a missing feature, or a documentation gap. The factory triage pipeline (Product Owner agent) will route it; you do not need to set labels yourself.

**Do not** open issues for:
- Questions that are answered by README.md or existing docs
- Vague "improvements" without concrete acceptance criteria
- Work that belongs in a separate downstream fork

See [.github/LABELS.md](.github/LABELS.md) for the full label taxonomy and what each label means for routing.

## 3. Branch and PR workflow

- **One PR per issue.** Reference the issue in the PR body (`Closes #N`).
- **Squash-merge only.** Each PR lands as a single commit on `main`; keep linear history.
- **Branch naming:** `<type>/<short-slug>` — e.g. `feat/add-login-page`, `fix/null-pointer`, `docs/contributing`.
- Keep the diff minimal: change only files required by the issue scope.
- When editing repository-inventory docs (for example README workflow/source-of-truth sections), verify every referenced path exists and re-check documented workflow trigger/cadence text against the live `.github/workflows/*` file before pushing.
- Run the checks in [§ 5 Testing](#5-testing-expectations) locally before pushing.

## 4. ADR requirement

Any change that picks a new infrastructure component, library, deploy topology, security boundary, or data model must be accompanied by an Architecture Decision Record (ADR).

- Template: [docs/adrs/TEMPLATE.md](docs/adrs/TEMPLATE.md)
- Index and process: [docs/adrs/README.md](docs/adrs/README.md)
- ADRs are **immutable once Accepted**. To revise a decision, write a new superseding ADR and update the old one's status field — do not rewrite the accepted body.
- **`.github/workflows/**` changes are a control-plane boundary** and always require an ADR in the same PR.

## 5. Testing expectations

Run these checks before opening a PR:

```bash
# Frontend — lint and build
npm --prefix frontend run lint
npm --prefix frontend run build

# Temporal worker — unit tests
python -m pytest temporal/tests
```

See [docs/testing.md](docs/testing.md) for the full test pyramid, integration tests, and E2E guidance.

## 6. Protected paths

The following paths require specialist review before merge. Avoid touching them unless the issue explicitly calls for it:

| Path | Reviewer |
|---|---|
| `.github/workflows/` | Platform Engineer |
| `.github/agents/` | Platform Engineer |
| `.github/tools/` | Platform Engineer |
| `.github/copilot-instructions.md` | Platform Engineer |
| `supabase/migrations/`, `supabase/seed.sql` | Database Steward |
| `temporal/` | Tech Reviewer |
| `docker-compose.yml`, `docker-compose.dev.yml`, `Makefile` | Platform Engineer |
| `charts/`, `deploy/` | Platform Engineer |
| Security policy files | Security Reviewer |

## 7. Code of conduct

This project follows the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) (v2.1). Be respectful, constructive, and inclusive. Harassment of any kind is not tolerated. Violations can be reported to the repository maintainers via a private issue or email.
