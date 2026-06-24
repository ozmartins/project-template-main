import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";

type YamlDocument = Record<string, unknown>;

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "../../../../../");

const DEPLOY_DEV_WORKFLOW_PATH = join(REPO_ROOT, ".github/workflows/deploy-dev.yml");
const RENDER_VALIDATE_WORKFLOW_PATH = join(REPO_ROOT, ".github/workflows/k8s-render-validate.yml");
const NAMESPACES_MANIFEST_PATH = join(REPO_ROOT, "deploy/k8s/namespaces.yaml");
const RBAC_MANIFEST_PATH = join(REPO_ROOT, "deploy/k8s/rbac-nonprod.yaml");
const DB_BOOTSTRAP_RBAC_MANIFEST_PATH = join(REPO_ROOT, "deploy/k8s/rbac-dev-db-bootstrap.yaml");

// App deploy namespaces (dev + test). Supabase is a shared-infra namespace with its
// own RBAC (rbac-dev-db-bootstrap.yaml) and is intentionally excluded from this set.
const ALLOWED_NONPROD_NAMESPACES = new Set(["10x-stack-dev", "10x-stack-test"]);

function loadYamlFile(path: string): YamlDocument {
  const parsed = yaml.load(readFileSync(path, "utf8"));
  expect(parsed).toBeTruthy();
  return parsed as YamlDocument;
}

function loadYamlDocuments(path: string): YamlDocument[] {
  const docs = yaml.loadAll(readFileSync(path, "utf8"));
  return docs.filter((doc): doc is YamlDocument => !!doc && typeof doc === "object");
}

function getGateScript(): string {
  const workflow = loadYamlFile(DEPLOY_DEV_WORKFLOW_PATH);
  const jobs = workflow["jobs"] as YamlDocument;
  const preflight = jobs["preflight"] as YamlDocument;
  const steps = preflight["steps"] as YamlDocument[];
  const gateStep = steps.find((step) => step["id"] === "gate");
  expect(gateStep).toBeTruthy();
  expect(typeof gateStep?.["run"]).toBe("string");
  return gateStep?.["run"] as string;
}

function getBootstrapRunScript(): string {
  const workflow = loadYamlFile(DEPLOY_DEV_WORKFLOW_PATH);
  const jobs = workflow["jobs"] as YamlDocument;
  const bootstrapDb = jobs["bootstrap-db"] as YamlDocument;
  const steps = bootstrapDb["steps"] as YamlDocument[];
  const bootstrapStep = steps.find(
    (step) => step["name"] === "Apply Supabase migrations + demo baseline seed (in-cluster job)"
  );
  expect(bootstrapStep).toBeTruthy();
  expect(typeof bootstrapStep?.["run"]).toBe("string");
  return bootstrapStep?.["run"] as string;
}

function runGateScript(
  env: NodeJS.ProcessEnv
): { appEnabled: string; bootstrapEnabled: string; summary: string; log: string } {
  const tempDir = mkdtempSync(join(tmpdir(), "deploy-dev-gate-"));
  const githubOutputPath = join(tempDir, "github_output.txt");
  const githubSummaryPath = join(tempDir, "github_summary.txt");
  writeFileSync(githubOutputPath, "");
  writeFileSync(githubSummaryPath, "");

  const result = spawnSync("bash", ["-eo", "pipefail", "-c", getGateScript()], {
    env: {
      ...process.env,
      ...env,
      GITHUB_OUTPUT: githubOutputPath,
      GITHUB_STEP_SUMMARY: githubSummaryPath,
    },
    encoding: "utf8",
  });

  const summary = readFileSync(githubSummaryPath, "utf8");
  const outputLines = readFileSync(githubOutputPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const outputs = new Map<string, string>();
  for (const line of outputLines) {
    const separatorIndex = line.indexOf("=");
    expect(separatorIndex).toBeGreaterThan(0);
    outputs.set(line.slice(0, separatorIndex), line.slice(separatorIndex + 1));
  }

  rmSync(tempDir, { recursive: true, force: true });

  expect(result.status).toBe(0);
  expect(outputs.get("app_enabled")).toBeTruthy();
  expect(outputs.get("bootstrap_enabled")).toBeTruthy();

  return {
    appEnabled: outputs.get("app_enabled")!,
    bootstrapEnabled: outputs.get("bootstrap_enabled")!,
    summary,
    log: `${result.stdout}${result.stderr}`,
  };
}

describe("phase2 nonprod deployment foundations", () => {
  describe("deploy-dev preflight gate", () => {
    it("skips deployment when deployment variables are absent", () => {
      const outcome = runGateScript({});
      expect(outcome.appEnabled).toBe("false");
      expect(outcome.bootstrapEnabled).toBe("false");
      expect(outcome.summary).toContain("## Deploy Dev preflight");
      expect(outcome.summary).toContain("| App deploy (frontend + worker) | ⏭️ skipped");
      expect(outcome.summary).toContain("| DB bootstrap | ⏭️ skipped");
      expect(outcome.summary).toContain("explicit least-privilege DB_BOOTSTRAP_USER");
      expect(outcome.log).not.toContain("App deploy enabled but DB bootstrap SKIPPED");
    });

    it("enables app deploy and DB bootstrap when all required settings are present", () => {
      const outcome = runGateScript({
        DEPLOY_ENABLED: "true",
        DEV_NAMESPACE: "10x-stack-dev",
        HAS_DEPLOY_KUBECONFIG: "true",
        HAS_DB_BOOTSTRAP_KUBECONFIG: "true",
        HAS_DB_BOOTSTRAP_USER: "true",
        HAS_DB_BOOTSTRAP_DB_NAME: "true",
      });
      expect(outcome.appEnabled).toBe("true");
      expect(outcome.bootstrapEnabled).toBe("true");
      expect(outcome.summary).toContain("| App deploy (frontend + worker) | ✅ enabled → `10x-stack-dev` |");
      expect(outcome.summary).toContain("| DB bootstrap | ✅ enabled |");
      expect(outcome.summary).toContain("10x-stack-dev");
      expect(outcome.log).not.toContain("App deploy enabled but DB bootstrap SKIPPED");
    });

    it("keeps app deploy enabled when DB bootstrap kubeconfig is missing", () => {
      const outcome = runGateScript({
        DEPLOY_ENABLED: "true",
        DEV_NAMESPACE: "10x-stack-dev",
        HAS_DEPLOY_KUBECONFIG: "true",
      });
      expect(outcome.appEnabled).toBe("true");
      expect(outcome.bootstrapEnabled).toBe("false");
      expect(outcome.summary).toContain("| App deploy (frontend + worker) | ✅ enabled → `10x-stack-dev` |");
      expect(outcome.summary).toContain("| DB bootstrap | ⏭️ skipped");
      expect(outcome.summary).toContain("explicit least-privilege DB_BOOTSTRAP_USER");
      expect(outcome.log).toContain("App deploy enabled but DB bootstrap SKIPPED");
    });

    it("keeps app deploy enabled when DB bootstrap variables are missing", () => {
      const outcome = runGateScript({
        DEPLOY_ENABLED: "true",
        DEV_NAMESPACE: "10x-stack-dev",
        HAS_DEPLOY_KUBECONFIG: "true",
        HAS_DB_BOOTSTRAP_KUBECONFIG: "true",
      });
      expect(outcome.appEnabled).toBe("true");
      expect(outcome.bootstrapEnabled).toBe("false");
      expect(outcome.summary).toContain("| App deploy (frontend + worker) | ✅ enabled → `10x-stack-dev` |");
      expect(outcome.summary).toContain("| DB bootstrap | ⏭️ skipped");
      expect(outcome.summary).toContain("explicit least-privilege DB_BOOTSTRAP_USER");
      expect(outcome.log).toContain("App deploy enabled but DB bootstrap SKIPPED");
    });

    it("keeps deploy and bootstrap jobs wired to separate preflight outputs", () => {
      const workflow = loadYamlFile(DEPLOY_DEV_WORKFLOW_PATH);
      const jobs = workflow["jobs"] as YamlDocument;
      const preflight = jobs["preflight"] as YamlDocument;
      const outputs = preflight["outputs"] as YamlDocument;
      const deploy = jobs["deploy"] as YamlDocument;
      const bootstrapDb = jobs["bootstrap-db"] as YamlDocument;

      expect(outputs["app_enabled"]).toBe("${{ steps.gate.outputs.app_enabled }}");
      expect(outputs["bootstrap_enabled"]).toBe("${{ steps.gate.outputs.bootstrap_enabled }}");
      expect(deploy["if"]).toBe("needs.preflight.outputs.app_enabled == 'true'");
      expect(bootstrapDb["if"]).toBe("needs.preflight.outputs.bootstrap_enabled == 'true'");
      expect(bootstrapDb["needs"]).toEqual(["preflight", "deploy"]);
    });

    it("adds an event-driven critical incident sentinel for deploy failures", () => {
      const workflow = loadYamlFile(DEPLOY_DEV_WORKFLOW_PATH);
      expect(workflow["permissions"]).toEqual({
        contents: "read",
        actions: "read",
      });
      const jobs = workflow["jobs"] as YamlDocument;
      const sentinel = jobs["deploy-failure-sentinel"] as YamlDocument;
      expect(sentinel).toBeTruthy();
      expect(sentinel["needs"]).toEqual(["preflight", "deploy"]);
      expect(sentinel["if"]).toContain("needs.deploy.result == 'failure'");
      expect(sentinel["permissions"]).toEqual({
        contents: "read",
        issues: "write",
      });

      const steps = sentinel["steps"] as YamlDocument[];
      const fileIncidentStep = steps.find((step) => step["name"] === "File / update critical deploy incident");
      expect(fileIncidentStep).toBeTruthy();
      expect((fileIncidentStep?.["env"] as YamlDocument)["GH_TOKEN"]).toBe("${{ github.token }}");
      const incidentScript = fileIncidentStep?.["run"] as string;
      expect(incidentScript).toContain("fingerprint:deploy-dev-failure");
      expect(incidentScript).toContain("priority:critical");
      expect(incidentScript).toContain("queue:platform");
      expect(incidentScript).toContain("helm history");
      expect(incidentScript).toContain("pending-upgrade");
    });
  });

  describe("deploy-dev Helm self-heal step", () => {
    function getDeployJobSteps(): YamlDocument[] {
      const workflow = loadYamlFile(DEPLOY_DEV_WORKFLOW_PATH);
      const jobs = workflow["jobs"] as YamlDocument;
      const deploy = jobs["deploy"] as YamlDocument;
      return deploy["steps"] as YamlDocument[];
    }

    function getExternalSecretRbacHandoffScript(): string {
      const steps = getDeployJobSteps();
      const handoffStep = steps.find(
        (step) => step["name"] === "Preflight ExternalSecret RBAC handoff"
      );
      expect(handoffStep).toBeTruthy();
      expect(typeof handoffStep?.["run"]).toBe("string");
      return handoffStep?.["run"] as string;
    }

    function getSelfHealScript(): string {
      const steps = getDeployJobSteps();
      const selfHealStep = steps.find(
        (step) => step["name"] === "Clear stuck Helm release state (if pending)"
      );
      expect(selfHealStep).toBeTruthy();
      expect(typeof selfHealStep?.["run"]).toBe("string");
      return selfHealStep?.["run"] as string;
    }

    it("exists in the deploy job and appears immediately before Helm upgrade", () => {
      const steps = getDeployJobSteps();
      const selfHealIdx = steps.findIndex(
        (step) => step["name"] === "Clear stuck Helm release state (if pending)"
      );
      const helmUpgradeIdx = steps.findIndex(
        (step) => step["name"] === "Helm upgrade (10x-stack-dev)"
      );
      expect(selfHealIdx).toBeGreaterThan(-1);
      expect(helmUpgradeIdx).toBeGreaterThan(-1);
      expect(helmUpgradeIdx).toBe(selfHealIdx + 1);
    });

    it("fails early with an operator handoff when gha-deployer lacks ExternalSecret RBAC", () => {
      const steps = getDeployJobSteps();
      const kubeconfigIdx = steps.findIndex(
        (step) => step["name"] === "Configure kubeconfig (namespace-scoped gha-deployer)"
      );
      const handoffIdx = steps.findIndex(
        (step) => step["name"] === "Preflight ExternalSecret RBAC handoff"
      );
      const pullSecretIdx = steps.findIndex(
        (step) => step["name"] === "Ensure acr-pull imagePullSecret exists"
      );

      expect(kubeconfigIdx).toBeGreaterThan(-1);
      expect(handoffIdx).toBe(kubeconfigIdx + 1);
      expect(pullSecretIdx).toBe(handoffIdx + 1);

      const script = getExternalSecretRbacHandoffScript();
      expect(script).toContain('for verb in get list watch create patch update delete; do');
      expect(script).toContain('kubectl auth can-i "$verb" externalsecrets.external-secrets.io');
      expect(script).toContain("deploy/k8s/rbac-nonprod.yaml");
      expect(script).toContain("cluster-admin or platform-operator credential");
      expect(script).toContain("cannot grant itself new Role/RoleBinding permissions");
    });

    it("no-ops when release is not in a pending-* state", () => {
      const script = getSelfHealScript();
      expect(script).toMatch(/\^\s*pending-/);
      expect(script).toContain("no cleanup needed");
    });

    it("clears pending state via rollback to last deployed revision", () => {
      const script = getSelfHealScript();
      expect(script).toContain("helm rollback rental-app");
      expect(script).toContain('select(.status == "deployed")');
    });

    it("falls back to kubectl delete secret when no deployed revision exists", () => {
      const script = getSelfHealScript();
      expect(script).toContain("kubectl delete secret");
      expect(script).toContain("owner=helm,name=rental-app,status=");
      expect(script).toContain("--ignore-not-found");
    });
  });

  describe("k8s-render-validate workflow coverage", () => {
    it("renders and validates every chart profile plus bootstrap manifests", () => {
      const workflow = loadYamlFile(RENDER_VALIDATE_WORKFLOW_PATH);
      const renderValidateJob = (workflow["jobs"] as YamlDocument)["render-validate"] as YamlDocument;
      const steps = renderValidateJob["steps"] as YamlDocument[];

      const lintTemplateStep = steps.find((step) => step["name"] === "Helm lint + template (base/dev/test/prod)");
      const profileValidationStep = steps.find((step) => step["name"] === "Schema-validate rendered chart per profile");
      const bootstrapValidationStep = steps.find((step) => step["name"] === "Schema-validate bootstrap manifests");

      expect(lintTemplateStep?.["run"]).toBe("bash charts/app/ci-test.sh");

      const profileValidationScript = profileValidationStep?.["run"] as string;
      expect(profileValidationScript).toContain(
        "for profile in values.yaml values-dev.yaml values-test.yaml values-prod.yaml; do"
      );
      expect(profileValidationScript).toContain('helm template rental-app charts/app -f "charts/app/$profile"');

      const bootstrapValidationScript = bootstrapValidationStep?.["run"] as string;
      expect(bootstrapValidationScript).toContain('compgen -G "deploy/k8s/*.yaml"');
      expect(bootstrapValidationScript).toContain("kubeconform -strict -summary -ignore-missing-schemas deploy/k8s/*.yaml");
    });

    it("asserts in-cluster bootstrap service-account boundary checks in deploy-dev", () => {
      const bootstrapScript = getBootstrapRunScript();
      expect(bootstrapScript).toContain(
        "bitnamilegacy/kubectl@sha256:9524faf8e3cefb47fa28244a5d15f95ec21a73d963273798e593e61f80712333"
      );
      expect(bootstrapScript).not.toContain("image: bitnami/kubectl:1.32.4");
      expect(bootstrapScript).toContain("require_can_i get pods");
      expect(bootstrapScript).toContain("require_can_i list pods");
      expect(bootstrapScript).toContain("require_can_i create pods/exec");
      expect(bootstrapScript).toContain("require_cannot_i create jobs.batch");
      expect(bootstrapScript).toContain("require_cannot_i create configmaps");
      expect(bootstrapScript).toContain("require_cannot_i delete pods");
      expect(bootstrapScript).toContain("seed.sql must set request.jwt.claim.role = 'service_role'");
      expect(bootstrapScript).toContain("probing each pod for writable-primary status.");
      expect(bootstrapScript).toContain("SELECT pg_is_in_recovery();");
      expect(bootstrapScript).toContain("Migration $migration_name failed with 'already exists'; refusing auto-adoption without explicit schema verification.");
    });
  });

  describe("nonprod namespace/RBAC safety", () => {
    it("keeps namespace manifests to configured app and shared-infra namespaces", () => {
      const namespaceDocs = loadYamlDocuments(NAMESPACES_MANIFEST_PATH);
      const namespaces = namespaceDocs.map((doc) => (doc["metadata"] as YamlDocument)["name"]);

      expect(namespaceDocs.every((doc) => doc["kind"] === "Namespace")).toBe(true);
      expect(namespaces).toEqual(["10x-stack-dev", "10x-stack-test", "10x-stack-supabase"]);
    });

    it("keeps RBAC namespace-scoped and avoids cluster-scoped bindings", () => {
      const rbacDocs = loadYamlDocuments(RBAC_MANIFEST_PATH);
      const kinds = rbacDocs.map((doc) => doc["kind"]);

      expect(kinds).not.toContain("ClusterRole");
      expect(kinds).not.toContain("ClusterRoleBinding");

      for (const doc of rbacDocs) {
        const kind = doc["kind"];
        if (kind === "ServiceAccount" || kind === "Role" || kind === "RoleBinding") {
          const metadata = doc["metadata"] as YamlDocument;
          expect(ALLOWED_NONPROD_NAMESPACES.has(metadata["namespace"] as string)).toBe(true);
        }

        if (kind === "RoleBinding") {
          const roleRef = doc["roleRef"] as YamlDocument;
          const subjects = doc["subjects"] as YamlDocument[];
          expect(roleRef["kind"]).toBe("Role");
          for (const subject of subjects) {
            expect(subject["kind"]).toBe("ServiceAccount");
            expect(ALLOWED_NONPROD_NAMESPACES.has(subject["namespace"] as string)).toBe(true);
          }
        }
      }

      const roles = rbacDocs.filter((doc) => doc["kind"] === "Role");
      expect(roles).toHaveLength(2);
      for (const role of roles) {
        const rules = role["rules"] as YamlDocument[];
        expect(rules).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              apiGroups: ["external-secrets.io"],
              resources: ["externalsecrets"],
              verbs: ["get", "list", "watch", "create", "patch", "update", "delete"],
            }),
          ])
        );
      }
    });

    it("keeps dev DB bootstrap RBAC least-privilege and namespace-scoped", () => {
      const bootstrapRbacDocs = loadYamlDocuments(DB_BOOTSTRAP_RBAC_MANIFEST_PATH);
      const kinds = bootstrapRbacDocs.map((doc) => doc["kind"]);

      expect(kinds).not.toContain("ClusterRole");
      expect(kinds).not.toContain("ClusterRoleBinding");

      const serviceAccounts = bootstrapRbacDocs.filter((doc) => doc["kind"] === "ServiceAccount");
      expect(serviceAccounts).toHaveLength(2);
      expect(
        serviceAccounts.every((doc) => {
          const metadata = doc["metadata"] as YamlDocument;
          return metadata["namespace"] === "10x-stack-supabase";
        })
      ).toBe(true);

      const roles = bootstrapRbacDocs.filter((doc) => doc["kind"] === "Role");
      expect(roles).toHaveLength(2);

      const ghaBootstrapRole = roles.find(
        (doc) => ((doc["metadata"] as YamlDocument)["name"] as string) === "gha-db-bootstrap"
      );
      expect(ghaBootstrapRole).toBeTruthy();
      expect((ghaBootstrapRole?.["rules"] as YamlDocument[]).length).toBe(5);

      const inClusterBootstrapRole = roles.find(
        (doc) => ((doc["metadata"] as YamlDocument)["name"] as string) === "db-bootstrap"
      );
      expect(inClusterBootstrapRole).toBeTruthy();
      expect((inClusterBootstrapRole?.["rules"] as YamlDocument[]).length).toBe(3);
      expect(inClusterBootstrapRole?.["rules"]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            apiGroups: [""],
            resources: ["configmaps"],
            verbs: ["get", "list", "watch"],
          }),
        ])
      );

      const roleBindings = bootstrapRbacDocs.filter((doc) => doc["kind"] === "RoleBinding");
      expect(roleBindings).toHaveLength(2);
      for (const roleBinding of roleBindings) {
        const metadata = roleBinding["metadata"] as YamlDocument;
        expect(metadata["namespace"]).toBe("10x-stack-supabase");
        const roleRef = roleBinding["roleRef"] as YamlDocument;
        expect(roleRef["kind"]).toBe("Role");
        const subjects = roleBinding["subjects"] as YamlDocument[];
        expect(subjects).toHaveLength(1);
        expect(subjects[0]["kind"]).toBe("ServiceAccount");
        expect(subjects[0]["namespace"]).toBe("10x-stack-supabase");
      }
    });
  });
});
