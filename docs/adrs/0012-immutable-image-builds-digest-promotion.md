# ADR-0012: Immutable Image Builds and Digest-Based Promotion

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Ian Reay, Factory Architect
- **Supersedes / Superseded by:** —

## Context

Container images built from a PR may contain untested changes. If a mutable tag like `latest` or `main` is used throughout the deploy pipeline, a deploy in one environment may silently pull a different image than was tested, because the tag moved between build and deploy. This makes environments non-reproducible and deploy incidents harder to diagnose.

## Decision

Every container image build produces an **immutable image identified by its content digest** (`sha256:...`). The digest is published as a workflow output and passed explicitly to each downstream deploy step.

Promotion across environments (dev → test → prod) moves the **same digest forward** — no rebuild, no tag mutation. The Helm chart receives the digest as an override:

```yaml
image:
  repository: <registry>/<image>
  tag: "" # unused for digest-pinned deploys
  digest: sha256:<hash>
  pullPolicy: IfNotPresent
```

**Development** (local and feature-branch builds) may use mutable tags with `pullPolicy: Always` for convenience. Test and production deployments must always use a digest.

**Push gating:** Images are only pushed to the container registry when building from `main` or when a PR passes all gating CI checks. Feature branches build and test locally but do not push.

## Consequences

**Positive:**
- Test and production deploys are reproducible: the exact image tested is the exact image deployed.
- Supply-chain risk is reduced: a tag mutation after a security scan cannot silently reach production.
- Rollback is `helm upgrade` with the previous digest — no rebuild required.
- `pullPolicy: IfNotPresent` with a digest guarantees the node never re-pulls unless the digest changes.

**Negative:**
- The deploy pipeline must carry the digest from the build step to each deploy step. This requires explicit output variable passing — more pipeline plumbing than a tag reference.
- Debugging a production issue requires correlating a running digest back to a source commit. The registry must store the git SHA as an image label to make this tractable.
- Local dev cannot conveniently use digest-pinned images — dev must remain on mutable tags.

## Alternatives considered

**Mutable tags throughout:** Simpler pipeline but non-reproducible. Tag drift between environments is a real incident cause.

**Semantic versioning tags (e.g., `1.2.3`):** More human-readable than digests and immutable if release automation creates them. Adds a versioning ceremony overhead; digests require zero extra process.

**Build on every deploy:** Guarantees freshness but couples build time to deploy latency and makes rollback dependent on a rebuild succeeding.

## Evidence

- `.github/workflows/build-images.yml` — image build, digest output, push gating
- `charts/app/values.yaml` — `image.digest` field in chart values
- `charts/app/values-test.yaml`, `values-prod.yaml` — digest override pattern
