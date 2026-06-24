import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readWorkflow(fileName: string) {
  return readFileSync(resolve(__dirname, "..", "..", ".github", "workflows", fileName), "utf8");
}

function extractSection(workflow: string, startMarker: string, endMarker: string) {
  const start = workflow.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);

  const end = workflow.indexOf(endMarker, start + startMarker.length);
  expect(end).toBeGreaterThan(start);

  return workflow.slice(start, end);
}

function gitHubExpression(expression: string) {
  return `\${{ ${expression} }}`;
}

const matrixImageNameExpression = gitHubExpression("matrix.image_name");
const frontendImageExpression = gitHubExpression(
  "needs.prepare-provenance-inputs.outputs.frontend_image"
);
const frontendDigestExpression = gitHubExpression(
  "needs.prepare-provenance-inputs.outputs.frontend_digest"
);
const temporalWorkerImageExpression = gitHubExpression(
  "needs.prepare-provenance-inputs.outputs.temporal_worker_image"
);
const temporalWorkerDigestExpression = gitHubExpression(
  "needs.prepare-provenance-inputs.outputs.temporal_worker_digest"
);

function extractRemainderFromMarker(workflow: string, startMarker: string) {
  const start = workflow.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);

  return workflow.slice(start);
}

function expectInOrder(text: string, snippets: string[]) {
  let previousIndex = -1;

  for (const snippet of snippets) {
    const index = text.indexOf(snippet);
    expect(index).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
}

describe("build-images security workflow contracts", () => {
  it("keeps the pull request path local-only and scan-gated before enforcement", () => {
    const workflow = readWorkflow("build-images.yml");
    const prJob = extractSection(workflow, "  build-images-pr:\n", "  build-images:\n");

    expect(prJob).toContain("push: false");
    expect(prJob).toContain("load: true");
    expectInOrder(prJob, [
      "- name: Scan — Trivy vuln (informational SARIF)",
      "- name: Scan — Trivy misconfig + secret",
      "- name: Scan — Grype (CVE, second opinion)",
      "- name: Audit — Dockle (CIS Benchmark)",
      "- name: Enforce scan gate",
    ]);

    // trivy-vuln (informational) and trivy-ms (blocking) must be separate steps
    expect(prJob).toContain("id: trivy-vuln");
    expect(prJob).toContain("scanners: vuln");
    expect(prJob).toContain("id: trivy-ms");
    expect(prJob).toContain("scanners: misconfig,secret");

    // trivy-ms must be part of the blocking gate; trivy-vuln must not set FAILED
    expect(prJob).toContain(
      `${gitHubExpression("steps.trivy-ms.outcome")}" == "failure" ]] && FAILED=1`
    );
    expect(prJob).not.toContain(
      `${gitHubExpression("steps.trivy-vuln.outcome")}" == "failure" ]] && FAILED=1`
    );

    // Grype config must be passed via GRYPE_CONFIG env var
    // (anchore/scan-action@v4.1.0 does not support the grype-config input)
    expect(prJob).toContain("GRYPE_CONFIG: .grype.yaml");
    // DB age validation must be bypassed on both paths: the GHA runner cache can hold
    // a Grype DB older than the 5-day max-allowed-built-age, which causes Grype to exit
    // without scanning (false-positive gate failure).  GRYPE_DB_UPDATE=true still runs
    // and downloads a fresh DB when the network is available.
    expect(prJob).toContain("GRYPE_DB_VALIDATE_AGE: 'false'");
  });

  it("keeps the push path scan-gated and preserves metadata handoff for downstream security jobs", () => {
    const workflow = readWorkflow("build-images.yml");
    const pushJob = extractSection(workflow, "  build-images:\n", "  sign-images:\n");
    const signImagesJob = extractSection(
      workflow,
      "  sign-images:\n",
      "  prepare-provenance-inputs:\n"
    );
    const provenanceInputsJob = extractSection(
      workflow,
      "  prepare-provenance-inputs:\n",
      "  frontend-provenance:\n"
    );

    expectInOrder(pushJob, [
      "- name: Scan — Trivy vuln (informational SARIF)",
      "- name: Scan — Trivy misconfig + secret",
      "- name: Scan — Grype (CVE, second opinion)",
      "- name: Audit — Dockle (CIS Benchmark)",
      "- name: Enforce scan gate",
      "- name: Build (and push on main when configured)",
      "- name: Write build metadata",
      "- name: Upload build metadata artifact",
      "- name: Write and upload image digest",
      "- name: Upload image digest artifact",
    ]);

    // same Trivy split and gate rules apply on the push path
    expect(pushJob).toContain("id: trivy-vuln");
    expect(pushJob).toContain("id: trivy-ms");
    expect(pushJob).toContain(
      `${gitHubExpression("steps.trivy-ms.outcome")}" == "failure" ]] && FAILED=1`
    );
    expect(pushJob).not.toContain(
      `${gitHubExpression("steps.trivy-vuln.outcome")}" == "failure" ]] && FAILED=1`
    );
    expect(pushJob).toContain("GRYPE_CONFIG: .grype.yaml");
    // DB age validation must be bypassed on both paths (see PR-path comment above).
    expect(pushJob).toContain("GRYPE_DB_VALIDATE_AGE: 'false'");

    expect(pushJob).toContain("if: steps.push-gate.outputs.enabled == 'true'");
    expect(pushJob).toContain(`name: build-metadata-${matrixImageNameExpression}`);
    expect(pushJob).toContain(`name: image-digest-${matrixImageNameExpression}`);
    expect(signImagesJob).toContain(`name: build-metadata-${matrixImageNameExpression}`);
    expect(signImagesJob).toContain("Expected a pushed digest");
    expect(signImagesJob).toContain("build metadata was empty.");
    expect(signImagesJob).toContain("exit 1");
    expect(provenanceInputsJob).toContain("pattern: build-metadata-*");
  });

  it("keeps sign-images responsible for cosign signing, SBOM generation/upload, and digest attestation for both images", () => {
    const workflow = readWorkflow("build-images.yml");
    const signImagesJob = extractSection(
      workflow,
      "  sign-images:\n",
      "  prepare-provenance-inputs:\n"
    );

    expect(signImagesJob).toContain("needs: build-images");
    expect(signImagesJob).toContain("image_name: [frontend, temporal-worker]");
    expectInOrder(signImagesJob, [
      "- name: Install Cosign",
      "- name: Sign pushed image digest",
      "- name: Generate image SBOM",
      "- name: Attest pushed image digest",
      "- name: Upload SBOM artifact",
    ]);
    expect(signImagesJob).toContain("cosign sign --yes");
    expect(signImagesJob).toContain("uses: anchore/sbom-action@");
    expect(signImagesJob).toContain("uses: actions/attest-build-provenance@");
    expect(signImagesJob).toContain("continue-on-error: true");
    expect(signImagesJob).toContain(`name: sbom-${matrixImageNameExpression}.spdx.json`);
  });

  it("keeps both SLSA provenance jobs gated on pushed digests from prepare-provenance-inputs", () => {
    const workflow = readWorkflow("build-images.yml");
    const frontendProvenanceJob = extractSection(
      workflow,
      "  frontend-provenance:\n",
      "  temporal-worker-provenance:\n"
    );
    const temporalWorkerProvenanceJob = extractRemainderFromMarker(
      workflow,
      "  temporal-worker-provenance:\n"
    );

    expect(frontendProvenanceJob).toContain("needs: prepare-provenance-inputs");
    expect(frontendProvenanceJob).toContain(
      "needs.prepare-provenance-inputs.outputs.frontend_enabled == 'true'"
    );
    expect(frontendProvenanceJob).toContain(
      "needs.prepare-provenance-inputs.outputs.frontend_digest != ''"
    );
    expect(frontendProvenanceJob).toContain(
      "uses: slsa-framework/slsa-github-generator/.github/workflows/generator_container_slsa3.yml@v2.1.0"
    );
    expect(frontendProvenanceJob).toContain(`image: ${frontendImageExpression}`);
    expect(frontendProvenanceJob).toContain(`digest: ${frontendDigestExpression}`);

    expect(temporalWorkerProvenanceJob).toContain("needs: prepare-provenance-inputs");
    expect(temporalWorkerProvenanceJob).toContain(
      "needs.prepare-provenance-inputs.outputs.temporal_worker_enabled == 'true'"
    );
    expect(temporalWorkerProvenanceJob).toContain(
      "needs.prepare-provenance-inputs.outputs.temporal_worker_digest != ''"
    );
    expect(temporalWorkerProvenanceJob).toContain(
      "uses: slsa-framework/slsa-github-generator/.github/workflows/generator_container_slsa3.yml@v2.1.0"
    );
    expect(temporalWorkerProvenanceJob).toContain(`image: ${temporalWorkerImageExpression}`);
    expect(temporalWorkerProvenanceJob).toContain(`digest: ${temporalWorkerDigestExpression}`);
  });
});

describe("scheduled container scan workflow contracts", () => {
  it("keeps the weekly cron and manual trigger plus the explicit ACR skip gate", () => {
    const workflow = readWorkflow("container-scan-scheduled.yml");

    expect(workflow).toContain("- cron: '0 6 * * 1'");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("- name: Check ACR configuration");
    expect(workflow).toContain('echo "ACR not configured — skipping scheduled scan"');
    expect(workflow).toContain('echo "enabled=false" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain('echo "enabled=true" >> "$GITHUB_OUTPUT"');
  });

  it("keeps Trivy SARIF upload and deduplicated security issue filing for CVE findings", () => {
    const workflow = readWorkflow("container-scan-scheduled.yml");

    expectInOrder(workflow, [
      "- name: Scan — Trivy (CVE + misconfig + secret)",
      "- name: Upload Trivy SARIF to Security tab",
      "- name: File issue on CVE findings",
    ]);
    expect(workflow).toContain(`category: scheduled-container-${matrixImageNameExpression}`);
    expect(workflow).toContain("if: steps.trivy.outcome == 'failure'");
    expect(workflow).toContain("gh issue list --state open --label security --json title");
    expect(workflow).toContain(`grep -c "${matrixImageNameExpression}" || true`);
    expect(workflow).toContain(
      `Open security issue already exists for ${matrixImageNameExpression}`
    );
    expect(workflow).toContain("skipping duplicate.");
  });
});
