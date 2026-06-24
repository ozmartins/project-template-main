# ADR-0121: Build-images native attestation step is non-blocking on private-org billing limits

- **Status:** Accepted
- **Date:** 2026-06-24
- **Deciders:** Copilot coding agent
- **Supersedes / Superseded by:** Extends ADR-0091

## Context
`CICD - Build Images` signs and scans pushed image digests, then runs `actions/attest-build-provenance` in `sign-images`.  
On this private organization billing plan, GitHub's attestations API returns `Feature not available for the Volaris-AI organization`, which fails the workflow even though image build, push, Cosign signing, SBOM generation, and SLSA provenance publication succeed.

## Decision
We keep the native `actions/attest-build-provenance` step in `build-images.yml`, but mark it `continue-on-error: true` with an inline billing-limitation note.  
SLSA provenance jobs remain required and unchanged.

## Consequences
**Better:**
- Main-branch image pipeline no longer fails solely because the native attestation API is unavailable on the current billing tier.
- Image build, push, scan, Cosign signing, SBOM upload, and SLSA provenance behavior remain intact.

**Trade-offs / obligations:**
- Native GitHub attestation persistence is best-effort until billing/support changes.
- If organization billing changes later, this step can be returned to blocking mode.

## Alternatives considered
| Option | Reason rejected |
|---|---|
| Remove the native attestation step entirely | Loses optional compatibility path for plans that do support GitHub attestations |
| Keep the step blocking | Continues to fail every main push despite successful image publication and SLSA provenance |

## Evidence
- `.github/workflows/build-images.yml`
- `temporal/tests/build_images_security_contract.test.ts`
- Issue: `Volaris-AI/project-template#1193`
- Failing run: `https://github.com/Volaris-AI/project-template/actions/runs/28086568777`
