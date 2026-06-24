# ADR-0041: Git Pre-Commit Hook Strategy

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

The template has comprehensive CI gates (ADR-0036) but no local pre-commit hooks. Without hooks, formatting drift, obvious lint errors, and accidental secret commits reach CI — creating a slow feedback loop (minutes to detect a forgotten semicolon or debug `console.log`). Adding hooks naively introduces the opposite problem: slow hooks that developers bypass with `--no-verify`, defeating the purpose entirely.

The project is polyglot (TypeScript frontend + TypeScript Temporal worker + optional Python + SQL migrations) and requires a hook strategy that:

- Runs fast enough that developers never want to bypass it (target: < 3 seconds on a typical staged changeset)
- Catches high-signal issues only — not issues that are already caught by CI with higher fidelity
- Works across all languages in the repo without requiring separate install steps
- Does not require CI to disable (hooks must be opt-out-able in automated contexts)

### What experienced teams run vs. skip

Research across practitioner forums, official tooling documentation, and adoption data (2024–2025) shows a clear consensus:

**Run in pre-commit:**
- Code formatting (auto-fix, near-zero DX cost)
- Fast linting on staged files only (not whole project)
- Secret/credential detection
- Commit message format enforcement

**Skip in pre-commit, defer to CI:**
- Full TypeScript type-checking (`tsc --noEmit`) — too slow on large projects, 30–90 seconds without project references / incremental compilation
- Test suite — defeats the purpose of fast pre-commit
- Helm validation, SQL migration checks — belong in path-scoped CI gates (ADR-0039)
- Full SAST (CodeQL, Semgrep) — runs nightly in non-gating CI lanes (ADR-0030)

## Decision

We use **Lefthook** as the hook manager with **staged-files-only** linting via Biome (TypeScript/JS) and Ruff (Python), plus a lightweight secret scan. Type-checking is explicitly deferred to CI.

### Hook manager: Lefthook

Lefthook is a single Go binary (~6 MB) with no Node.js runtime dependency. It supports parallel job execution within a single hook event, making it faster than the Husky + lint-staged sequential model for multi-linter setups. It handles polyglot monorepos natively via glob filters and works the same way regardless of which package manager the project uses.

In CI, hooks are skipped by setting `CI=true` in the environment (Lefthook skips automatically) or via `LEFTHOOK=0`. No special `prepare` script management required.

### Pre-commit hook contents

```
pre-commit
├── biome-check     (staged *.ts, *.tsx, *.js, *.jsx, *.json — format + lint, auto-fix)
├── ruff-check      (staged *.py — lint, auto-fix)
├── ruff-format     (staged *.py — format, auto-fix)
└── secret-scan     (all staged files — gitleaks detect --staged)
```

**What is NOT in the hook:**
- `tsc --noEmit` — runs as Layer 1 static check in `pr-validation.yml` instead
- Vitest / pytest — runs as Layer 2 unit tests in `pr-validation.yml`
- Helm lint — runs as Layer 1 in `pr-validation.yml`
- SQL / migration checks — runs as Layer 3 reset-path gate in `pr-validation.yml`

### commit-msg hook

A lightweight regex check enforces conventional commit format (`type(scope): description`) to support the automated PR enrichment pipeline (ADR-0032) and changelog generation.

### TypeScript strategy: Biome v2 over tsc in pre-commit

Biome v2 (released 2025) introduced type-aware linting that does not require the TypeScript compiler. It catches ~75% of the high-signal type issues (floating promises, unreachable code, unsafe assignments) in milliseconds rather than the 30–90 seconds `tsc --noEmit` requires. Full type-correctness is then guaranteed by `tsc --noEmit` running as a gating CI check on every PR. This split is the correct tradeoff: fast signal locally, complete correctness in CI.

### Staged-files-only processing

Both Biome (`--staged` flag) and lint-staged-style invocations process only git-indexed files. This means a 200-file repo runs hooks against the 3 files you actually changed. The critical exception: `tsc --noEmit` must NOT be passed individual filenames (it ignores `tsconfig.json` when invoked that way) — this is why it belongs in CI, not in a staged-files hook.

### Speed targets

| Hook job | Typical staged changeset | Worst case (50 staged files) |
|---|---|---|
| biome-check | < 0.5s | < 2s |
| ruff-check + ruff-format | < 0.3s | < 1s |
| secret-scan (gitleaks) | < 0.5s | < 1s |
| commit-msg regex | < 10ms | < 10ms |
| **Total** | **< 1.5s** | **< 4s** |

### Configuration files

```
lefthook.yml           — hook definitions, glob filters, parallel: true
.gitleaks.toml         — allowlist for known test fixtures / false positives
commitlint.config.js   — conventional commit ruleset (if not using inline regex)
```

CI skips hooks via `LEFTHOOK=0` in GitHub Actions runner environment. Individual developers can skip with `git commit --no-verify` but this is explicitly not recommended and tracked via the architecture audit (ADR-0028).

## Consequences

**Positive:**
- Formatting drift eliminated at the source: no more "fix formatting" commits clogging history
- Secret commits caught before push, not after a CI alert
- Sub-2-second feedback for the typical case — developers will not bypass hooks
- Lefthook's parallel execution means adding a new language linter (e.g., shellcheck for bash scripts) costs zero additional wall-clock time if other jobs are already running
- Polyglot support: same tool manages TS, Python, and future languages without per-language hook managers

**Negative:**
- Type errors that are not caught by Biome's heuristics (estimated ~25% of tsc-detectable issues) reach CI rather than being caught locally — this is acceptable because CI runs in < 2 minutes for Layer 1 checks
- Lefthook requires a one-time `lefthook install` after cloning; this must be documented in the README and `make` setup commands
- gitleaks adds a Go binary dependency (installable via Homebrew / pre-built binary) — teams without it need a bootstrap step

## Alternatives considered

**Husky + lint-staged**

The de-facto standard. ~1ms Husky overhead, lint-staged handles staged-file scoping well. Rejected for this template because: (1) requires `npm install` in the root (polyglot repos don't always have a root `package.json`), (2) sequential job execution is slower than Lefthook's parallel model for multi-linter setups, (3) no native Go binary — Lefthook is faster when hooks run concurrently.

**Husky + lint-staged (keep for frontend-only subprojects)**

Valid choice if a consumer of this template strips the Python/Temporal layers and runs a pure Node.js stack. The template's `frontend/` directory can optionally retain a lint-staged config for local dev without adopting Lefthook globally.

**simple-git-hooks**

Appropriate for tiny single-language projects. The simple-git-hooks docs themselves recommend Lefthook or Husky for projects needing multiple commands per hook. This template runs 4 parallel jobs, making simple-git-hooks unfit.

**Running tsc --noEmit in pre-commit with `--incremental`**

TypeScript's `--incremental` flag caches compilation state and can reduce type-check time from 60s to ~5s on repeated runs. Rejected because: (1) cold runs (new clone, clean build) still hit full compile time; (2) the incremental cache (`.tsbuildinfo`) conflicts with some CI setups; (3) Biome v2 already catches the high-signal subset. Incremental tsc remains available as a developer opt-in (`npm run typecheck:watch`) but is not wired into the pre-commit hook.

**No pre-commit hooks (CI-only)**

Valid in high-velocity factory environments where PRs are small and CI is < 2 minutes. The cost here is that auto-fixable issues (formatting, import ordering) require a round-trip through CI and a fixup commit. Given that Biome runs in < 500ms and auto-fixes staged files in place, the DX cost of running it locally is negligible.

## Implementation

- Add `lefthook.yml` to repo root with `pre-commit` and `commit-msg` hooks
- Add `.gitleaks.toml` with project-appropriate allowlist
- Add `lefthook install` to `make setup` / bootstrap script
- Add `LEFTHOOK=0` to GitHub Actions job environment in `pr-validation.yml`
- Document in README: "after cloning, run `make setup` to install git hooks"
- Add Biome as a dev dependency in `frontend/package.json` and `temporal/package.json`
- Ruff and gitleaks installed via `make setup` as system tools (not npm deps)

## Evidence

- [Lefthook docs](https://github.com/evilmartians/lefthook) — parallel execution, `stage_fixed: true`, polyglot support
- [Biome Git Hooks Guide](https://biomejs.dev/recipes/git-hooks/) — official recommendation for Lefthook as fastest integration
- [Biome v2 type-aware linting](https://biomejs.dev/blog/biome-v2/) — no-compiler type linting, 2025
- [lint-staged TypeScript pattern](https://github.com/okonet/lint-staged) — function syntax for `tsc --noEmit`, staged-only caveats
- [Ruff pre-commit integration](https://docs.astral.sh/ruff/integrations/) — `ruff-check` + `ruff-format` hook ordering
- [Biome VCS --staged flag](https://biomejs.dev/guides/integrate-in-vcs/) — staged vs changed tradeoff documentation
- ADR-0036 — testing pyramid layers; Layer 1 (static + build) is where tsc/ESLint/Helm run in CI
- ADR-0028 — standing architecture audits; `--no-verify` bypass tracking
- ADR-0030 — non-gating quality lanes (SAST, coverage) that explicitly do not belong in pre-commit
