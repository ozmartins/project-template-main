# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| `main`  | Yes       |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report security issues privately via [GitHub's private vulnerability reporting](https://github.com/Volaris-AI/project-template/security/advisories/new).

You can expect:
- Acknowledgement within 48 hours
- A status update within 7 days
- A patch or mitigation plan within 30 days for confirmed issues

## Scope

In scope:
- Authentication and authorisation bypass in the Supabase RLS/RBAC layer
- Injection vulnerabilities (SQL, command, template) in Temporal activities
- Secrets or credentials exposed in logs, responses, or build artefacts
- Broken access control in API routes or RPC guards

Out of scope:
- Denial of service / resource exhaustion
- Issues already publicly known (CVEs in third-party dependencies)
- Social engineering

## Active Security Controls

| Control | Status |
|---|---|
| Dependabot vulnerability alerts | Enabled |
| Dependabot automated security PRs | Enabled |
| Secret scanning | Enabled |
| Secret scanning push protection | Enabled |
| Branch protection on `main` | Enabled |
| CODEOWNERS review required | Enabled |
| Required status checks (`Summary`) | Enabled |
| Stale review dismissal | Enabled |
| Force-push blocked on `main` | Enabled |
| Branch deletion blocked on `main` | Enabled |
| Delete-branch-on-merge | Enabled |
