#!/usr/bin/env bash
# charts/app/ci-test.sh
#
# Validate the app Helm chart and its environment-specific values profiles.
# Runs helm lint + helm template checks for base, dev, test, and prod profiles.
#
# Usage (from repo root):
#   bash charts/app/ci-test.sh
#
# Requirements: helm 3.x on PATH.

set -euo pipefail

CHART="charts/app"
RELEASE="ci-test"
PASS=0
FAIL=0

pass() { printf "  ✅ %s\n" "$1"; PASS=$((PASS + 1)); }
fail() { printf "  ❌ FAIL: %s\n" "$1"; FAIL=$((FAIL + 1)); }

# assert_contains <rendered_manifest> <label> <extended_regexp>
assert_contains() {
  local manifest="$1" label="$2" pattern="$3"
  if grep -qE -- "$pattern" <<<"$manifest"; then
    pass "$label"
  else
    fail "$label — expected pattern not found: $pattern"
  fi
}

# assert_not_contains <rendered_manifest> <label> <extended_regexp>
assert_not_contains() {
  local manifest="$1" label="$2" pattern="$3"
  if grep -qE -- "$pattern" <<<"$manifest"; then
    fail "$label — unexpected pattern found: $pattern"
  else
    pass "$label"
  fi
}

extract_named_doc() {
  local manifest="$1" kind="$2" name="$3"
  awk -v kind="$kind" -v name="$name" 'BEGIN{RS="---\n"; ORS=""} $0 ~ "kind: " kind && $0 ~ "name: " name {print}' <<<"$manifest"
}

assert_doc_present() {
  local doc="$1" label="$2"
  if [ -n "$doc" ]; then
    pass "$label"
  else
    fail "$label — expected manifest was not found"
  fi
}

assert_port_count() {
  local manifest="$1" label="$2" expected="$3"
  local count
  count=$(grep -cE '^[[:space:]]*- port:' <<<"$manifest" || true)
  if [ "$count" -eq "$expected" ]; then
    pass "$label"
  else
    fail "$label — expected ${expected} ports, found ${count}"
  fi
}

# ── helm lint ─────────────────────────────────────────────────────────────────
echo "=== helm lint ==="

lint_check() {
  local label="$1"; shift
  if helm lint "$@" >/dev/null 2>&1; then
    pass "lint: $label"
  else
    fail "lint: $label"
    helm lint "$@" || true
  fi
}

lint_check "base chart"                  "$CHART"
lint_check "values-dev.yaml"       "$CHART" -f "$CHART/values-dev.yaml"
lint_check "values-test.yaml"      "$CHART" -f "$CHART/values-test.yaml"
lint_check "values-prod.yaml"      "$CHART" -f "$CHART/values-prod.yaml"
lint_check "values-aws-dev.yaml"   "$CHART" -f "$CHART/values-aws-dev.yaml"
lint_check "values-azure-dev.yaml" "$CHART" -f "$CHART/values-azure-dev.yaml"

# ── invalid values guardrails ──────────────────────────────────────────────────
echo ""
echo "=== invalid values guardrails ==="

if helm template "$RELEASE" "$CHART" \
  --set hpa.enabled=true \
  --set hpa.frontend.minReplicas=5 \
  --set hpa.frontend.maxReplicas=4 >/tmp/app-hpa-guard.out 2>&1; then
  fail "guardrail: frontend HPA rejects minReplicas > maxReplicas"
else
  assert_contains "$(cat /tmp/app-hpa-guard.out)" \
    "guardrail: frontend HPA rejects minReplicas > maxReplicas" \
    "hpa\\.frontend\\.minReplicas must be less than or equal to hpa\\.frontend\\.maxReplicas"
fi

if helm template "$RELEASE" "$CHART" \
  --set pdb.enabled=true \
  --set frontend.replicaCount=1 \
  --set pdb.frontend.minAvailable=2 >/tmp/app-pdb-guard.out 2>&1; then
  fail "guardrail: frontend PDB rejects minAvailable > replicaCount"
else
  assert_contains "$(cat /tmp/app-pdb-guard.out)" \
    "guardrail: frontend PDB rejects minAvailable > replicaCount" \
    "pdb\\.frontend\\.minAvailable must be less than or equal to the frontend minimum replica count"
fi

# ── base chart (default values) ───────────────────────────────────────────────
echo ""
echo "=== base chart (default values) ==="
BASE=$(helm template "$RELEASE" "$CHART")

assert_contains     "$BASE" "base: frontend Deployment present"         "kind: Deployment"
assert_contains     "$BASE" "base: Service present"                     "kind: Service"
assert_contains     "$BASE" "base: ops-api Deployment present"          "name: ${RELEASE}-app-ops-api"
assert_contains     "$BASE" "base: ops-api Service present"             "name: ${RELEASE}-app-ops-api"
assert_contains     "$BASE" "base: temporal taskQueue defaults to namespace-main" "default-main"
BASE_NAMESPACE="10x-stack-dev"
BASE_NS_RENDER=$(helm template "$RELEASE" "$CHART" --namespace "$BASE_NAMESPACE")
assert_contains     "$BASE_NS_RENDER" "base: temporal taskQueue respects custom release namespace" "${BASE_NAMESPACE}-main"
assert_contains     "$BASE" "base: secretKeyRef used for frontend key"  "secretKeyRef"
assert_contains     "$BASE" "base: frontend PDB present"                "kind: PodDisruptionBudget"
assert_contains     "$BASE" "base: frontend PDB name"                   "name: ${RELEASE}-app-frontend"
assert_contains     "$BASE" "base: worker PDB name"                     "name: ${RELEASE}-app-temporal-worker"
assert_contains     "$BASE" "base: ops-api PDB name"                    "name: ${RELEASE}-app-ops-api"
assert_contains     "$BASE" "base: NetworkPolicy enabled by default"     "kind: NetworkPolicy"
assert_not_contains "$BASE" "base: HPA disabled by default"             "kind: HorizontalPodAutoscaler"
# No Ingress by default
assert_not_contains "$BASE" "base: no Ingress rendered by default"      "kind: Ingress"
# Sensitive env vars must not appear as plain value: fields
assert_not_contains "$BASE" "base: VITE_SUPABASE_ANON_KEY not literal"      "value:.*VITE_SUPABASE_ANON_KEY"
assert_not_contains "$BASE" "base: SUPABASE_SERVICE_ROLE_KEY not literal"    "value:.*SUPABASE_SERVICE_ROLE_KEY"
# Default tag is "latest" (mutable) → pullPolicy must NOT be IfNotPresent (ADR-0010)
assert_not_contains "$BASE" "base: pullPolicy not IfNotPresent with mutable tag" "imagePullPolicy: IfNotPresent"
assert_contains     "$BASE" "base: pod runAsNonRoot enabled"             "runAsNonRoot: true"
assert_contains     "$BASE" "base: frontend runAsUser non-root"          "runAsUser: 10001"
assert_contains     "$BASE" "base: worker runAsUser non-root"            "runAsUser: 10001"
assert_contains     "$BASE" "base: seccomp runtime default"              "type: RuntimeDefault"
assert_contains     "$BASE" "base: priv-esc disabled"                    "allowPrivilegeEscalation: false"
assert_contains     "$BASE" "base: root fs readonly"                     "readOnlyRootFilesystem: true"
assert_contains     "$BASE" "base: all capabilities dropped"             "drop:"
assert_contains     "$BASE" "base: frontend nginx cache writable mount"  "mountPath: /var/cache/nginx"
assert_contains     "$BASE" "base: frontend run dir writable mount"      "mountPath: /var/run"
assert_contains     "$BASE" "base: worker tmp writable mount"            "name: temporal-worker-tmp"
assert_contains     "$BASE" "base: ops-api tmp writable mount"           "name: ops-api-tmp"
assert_not_contains "$BASE" "base: ops-api SUPABASE_SERVICE_ROLE_KEY not literal" "value:.*SUPABASE_SERVICE_ROLE_KEY"
# ExternalSecret disabled by default
assert_not_contains "$BASE" "base: no ExternalSecret by default (ADR-0042)" "kind: ExternalSecret"

# ops-api-scoped hardening assertions — these fail if ops-api loses its security contexts
OPS_API_DEPLOY=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: Deployment/ && /component: ops-api/' <<<"$BASE")
assert_contains "$OPS_API_DEPLOY" "base: ops-api podSecurityContext runAsNonRoot"    "runAsNonRoot: true"
assert_contains "$OPS_API_DEPLOY" "base: ops-api podSecurityContext runAsUser=10001" "runAsUser: 10001"
assert_contains "$OPS_API_DEPLOY" "base: ops-api seccomp RuntimeDefault"             "type: RuntimeDefault"
assert_contains "$OPS_API_DEPLOY" "base: ops-api allowPrivilegeEscalation=false"     "allowPrivilegeEscalation: false"
assert_contains "$OPS_API_DEPLOY" "base: ops-api readOnlyRootFilesystem"             "readOnlyRootFilesystem: true"
assert_contains "$OPS_API_DEPLOY" "base: ops-api capabilities.drop ALL"              "drop:"
assert_contains "$OPS_API_DEPLOY" "base: ops-api command uses node runtime"           "command:"
assert_contains "$OPS_API_DEPLOY" "base: ops-api command starts dist/worker.js"       "dist/worker\\.js"
assert_not_contains "$OPS_API_DEPLOY" "base: ops-api command does not call python"    "^[[:space:]]*-[[:space:]]*python$"
# base profile has replicaCount=1 — no anti-affinity should be rendered (only fires when replicas > 1)
assert_not_contains "$OPS_API_DEPLOY" "base: ops-api no podAntiAffinity with 1 replica" "podAntiAffinity:"

# frontend-scoped hardening assertions — guardrail: fail if frontend loses its security contexts
FRONTEND_DEPLOY=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: Deployment/ && /component: frontend/' <<<"$BASE")
assert_contains "$FRONTEND_DEPLOY" "base: frontend podSecurityContext runAsNonRoot"    "runAsNonRoot: true"
assert_contains "$FRONTEND_DEPLOY" "base: frontend podSecurityContext runAsUser=10001"   "runAsUser: 10001"
assert_contains "$FRONTEND_DEPLOY" "base: frontend podSecurityContext runAsGroup=10001"  "runAsGroup: 10001"
assert_contains "$FRONTEND_DEPLOY" "base: frontend seccomp RuntimeDefault"             "type: RuntimeDefault"
assert_contains "$FRONTEND_DEPLOY" "base: frontend allowPrivilegeEscalation=false"     "allowPrivilegeEscalation: false"
assert_contains "$FRONTEND_DEPLOY" "base: frontend readOnlyRootFilesystem"             "readOnlyRootFilesystem: true"
assert_contains "$FRONTEND_DEPLOY" "base: frontend capabilities.drop ALL"              "drop:"
# frontend writable-path mounts — entrypoint writes to /tmp; nginx needs /var/cache/nginx and /var/run
assert_contains "$FRONTEND_DEPLOY" "base: frontend /tmp writable emptyDir mount"       "mountPath: /tmp"
assert_contains "$FRONTEND_DEPLOY" "base: frontend /var/cache/nginx writable mount"    "mountPath: /var/cache/nginx"
assert_contains "$FRONTEND_DEPLOY" "base: frontend /var/run writable mount"            "mountPath: /var/run"
# base profile has replicaCount=1 — no anti-affinity should be rendered (only fires when replicas > 1)
assert_not_contains "$FRONTEND_DEPLOY" "base: frontend no podAntiAffinity with 1 replica" "podAntiAffinity:"
assert_not_contains "$OPS_API_DEPLOY"  "base: ops-api no podAntiAffinity with 1 replica"  "podAntiAffinity:"

# temporal-worker-scoped hardening assertions — guardrail: fail if worker loses its security contexts
WORKER_DEPLOY=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: Deployment/ && /component: temporal-worker/' <<<"$BASE")
assert_contains "$WORKER_DEPLOY" "base: temporal-worker podSecurityContext runAsNonRoot"     "runAsNonRoot: true"
assert_contains "$WORKER_DEPLOY" "base: temporal-worker podSecurityContext runAsUser=10001"  "runAsUser: 10001"
assert_contains "$WORKER_DEPLOY" "base: temporal-worker podSecurityContext runAsGroup=10001" "runAsGroup: 10001"
assert_contains "$WORKER_DEPLOY" "base: temporal-worker seccomp RuntimeDefault"              "type: RuntimeDefault"
assert_contains "$WORKER_DEPLOY" "base: temporal-worker allowPrivilegeEscalation=false"      "allowPrivilegeEscalation: false"
assert_contains "$WORKER_DEPLOY" "base: temporal-worker readOnlyRootFilesystem"              "readOnlyRootFilesystem: true"
assert_contains "$WORKER_DEPLOY" "base: temporal-worker capabilities.drop ALL"               "drop:"
# temporal-worker writable-path mount — worker needs /tmp for transient files
assert_contains "$WORKER_DEPLOY" "base: temporal-worker /tmp writable emptyDir mount"        "mountPath: /tmp"
assert_contains "$FRONTEND_DEPLOY" "base: frontend serviceAccountName set"                   "serviceAccountName:"
assert_contains "$WORKER_DEPLOY" "base: temporal-worker serviceAccountName set"              "serviceAccountName:"
assert_contains "$OPS_API_DEPLOY" "base: ops-api serviceAccountName set"                     "serviceAccountName:"
assert_contains "$FRONTEND_DEPLOY" "base: frontend automountServiceAccountToken disabled"    "automountServiceAccountToken: false"
assert_contains "$WORKER_DEPLOY" "base: temporal-worker automountServiceAccountToken disabled" "automountServiceAccountToken: false"
assert_contains "$OPS_API_DEPLOY" "base: ops-api automountServiceAccountToken disabled"      "automountServiceAccountToken: false"

# probe-type regression guard (kube-score CRITICAL #1012)
# Liveness must use tcpSocket; readiness must use httpGet.  If both become
# identical the kube-score scan re-raises a CRITICAL "Pod Probes Identical"
# finding.  These assertions catch that regression before a PR is merged.
assert_contains     "$OPS_API_DEPLOY"  "base: ops-api liveness probe uses tcpSocket"      "tcpSocket:"
assert_contains     "$OPS_API_DEPLOY"  "base: ops-api readiness probe uses httpGet"        "httpGet:"
assert_contains     "$FRONTEND_DEPLOY" "base: frontend liveness probe uses tcpSocket"      "tcpSocket:"
assert_contains     "$FRONTEND_DEPLOY" "base: frontend readiness probe uses httpGet"       "httpGet:"
# temporal-worker uses exec probes; the readiness command includes 2>/dev/null to
# disambiguate it from liveness — assert the differentiator is present.
assert_contains     "$WORKER_DEPLOY"   "base: temporal-worker liveness probe uses exec"            "kill -0 1"
assert_contains     "$WORKER_DEPLOY"   "base: temporal-worker readiness probe is disambiguated"    "2>/dev"

FRONTEND_SA=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: ServiceAccount/ && /component: frontend/' <<<"$BASE")
WORKER_SA=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: ServiceAccount/ && /component: temporal-worker/' <<<"$BASE")
OPS_API_SA=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: ServiceAccount/ && /component: ops-api/' <<<"$BASE")
assert_contains "$FRONTEND_SA" "base: frontend ServiceAccount rendered"                      "kind: ServiceAccount"
assert_contains "$WORKER_SA" "base: temporal-worker ServiceAccount rendered"                 "kind: ServiceAccount"
assert_contains "$OPS_API_SA" "base: ops-api ServiceAccount rendered"                        "kind: ServiceAccount"
assert_contains "$FRONTEND_SA" "base: frontend ServiceAccount keeps identity on uninstall"   "helm\\.sh/resource-policy: keep"
assert_contains "$WORKER_SA" "base: temporal-worker ServiceAccount keeps identity on uninstall" "helm\\.sh/resource-policy: keep"
assert_contains "$OPS_API_SA" "base: ops-api ServiceAccount keeps identity on uninstall"     "helm\\.sh/resource-policy: keep"
assert_contains "$FRONTEND_SA" "base: frontend ServiceAccount token automount disabled"      "automountServiceAccountToken: false"
assert_contains "$WORKER_SA" "base: temporal-worker ServiceAccount token automount disabled" "automountServiceAccountToken: false"
assert_contains "$OPS_API_SA" "base: ops-api ServiceAccount token automount disabled"        "automountServiceAccountToken: false"

SERVICE_ACCOUNT_RENDER=$(helm template "$RELEASE" "$CHART" \
  --set frontend.serviceAccount.name=frontend-sa \
  --set temporalWorker.serviceAccount.name=worker-sa \
  --set opsApi.serviceAccount.name=ops-api-sa)
assert_contains "$SERVICE_ACCOUNT_RENDER" "base: frontend serviceAccountName override"        "serviceAccountName: .*frontend-sa"
assert_contains "$SERVICE_ACCOUNT_RENDER" "base: temporal-worker serviceAccountName override" "serviceAccountName: .*worker-sa"
assert_contains "$SERVICE_ACCOUNT_RENDER" "base: ops-api serviceAccountName override"         "serviceAccountName: .*ops-api-sa"
FRONTEND_SA_RENDERED=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: ServiceAccount/ && /component: frontend/' <<<"$SERVICE_ACCOUNT_RENDER")
WORKER_SA_RENDERED=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: ServiceAccount/ && /component: temporal-worker/' <<<"$SERVICE_ACCOUNT_RENDER")
OPS_API_SA_RENDERED=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: ServiceAccount/ && /component: ops-api/' <<<"$SERVICE_ACCOUNT_RENDER")
assert_not_contains "$FRONTEND_SA_RENDERED" "base: frontend ServiceAccount not rendered when overridden" "kind: ServiceAccount"
assert_not_contains "$WORKER_SA_RENDERED" "base: temporal-worker ServiceAccount not rendered when overridden" "kind: ServiceAccount"
assert_not_contains "$OPS_API_SA_RENDERED" "base: ops-api ServiceAccount not rendered when overridden" "kind: ServiceAccount"

SERVICE_ACCOUNT_RENDER=$(helm template "$RELEASE" "$CHART" \
  --set frontend.serviceAccount.name=frontend-sa \
  --set temporalWorker.serviceAccount.name=worker-sa \
  --set opsApi.serviceAccount.name=ops-api-sa)
assert_contains "$SERVICE_ACCOUNT_RENDER" "base: frontend serviceAccountName override"        "serviceAccountName: .*frontend-sa"
assert_contains "$SERVICE_ACCOUNT_RENDER" "base: temporal-worker serviceAccountName override" "serviceAccountName: .*worker-sa"
assert_contains "$SERVICE_ACCOUNT_RENDER" "base: ops-api serviceAccountName override"         "serviceAccountName: .*ops-api-sa"

# ── digest rendering (inline render with --set) ────────────────────────────────
echo ""
echo "=== digest rendering ==="
DIGEST_SHA="sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
DIGEST_RENDER=$(helm template "$RELEASE" "$CHART" \
  --set "imageRegistry=example.azurecr.io" \
  --set "frontend.image.repository=frontend" \
  --set "frontend.image.digest=${DIGEST_SHA}" \
  --set "temporalWorker.image.repository=temporal-worker" \
  --set "temporalWorker.image.digest=${DIGEST_SHA}" \
  --set "opsApi.image.repository=temporal-worker" \
  --set "opsApi.image.digest=${DIGEST_SHA}")

assert_contains     "$DIGEST_RENDER" "digest: frontend image uses @sha256: form"         "image: example.azurecr.io/frontend@sha256:"
assert_contains     "$DIGEST_RENDER" "digest: worker image uses @sha256: form"           "image: example.azurecr.io/temporal-worker@sha256:"
assert_contains     "$DIGEST_RENDER" "digest: ops-api image uses @sha256: form"          "image: example.azurecr.io/temporal-worker@sha256:"
assert_not_contains "$DIGEST_RENDER" "digest: no :tag suffix when digest is set"         "image: example.azurecr.io/frontend:latest"

# ── dev profile ───────────────────────────────────────────────────────────────
echo ""
echo "=== values-dev.yaml ==="
DEV=$(helm template "$RELEASE" "$CHART" -f "$CHART/values-dev.yaml")
DEV_VALUES=$(cat "$CHART/values-dev.yaml")
DEV_NAMESPACE="10x-stack-dev"

assert_contains     "$DEV" "dev: frontend Deployment renders"           "kind: Deployment"
assert_contains     "$DEV" "dev: frontend replicas=1"                   "replicas: 1"
assert_not_contains "$DEV" "dev: no Ingress (ingress.enabled=false)"    "kind: Ingress"
# Scope to the frontend Service document in the multi-doc helm template output.
DEV_FRONTEND_SERVICE=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: Service/ && /app.kubernetes.io\/component: frontend/' <<<"$DEV")
if [ -z "$DEV_FRONTEND_SERVICE" ]; then
  fail "dev: frontend Service manifest extracted"
else
  pass "dev: frontend Service manifest extracted"
fi
assert_contains     "$DEV_FRONTEND_SERVICE" "dev: frontend service type=LoadBalancer" "type: LoadBalancer"
assert_contains     "$DEV" "dev: frontend image tag=dev-latest"         "image: (.*/)?frontend:dev-latest"
assert_contains     "$DEV" "dev: worker image tag=dev-latest"           "image: (.*/)?temporal-worker:dev-latest"
assert_contains     "$DEV" "dev: ops-api image tag=dev-latest"          "image: (.*/)?temporal-worker:dev-latest"
assert_contains     "$DEV" "dev: temporal namespace=${DEV_NAMESPACE}"          "${DEV_NAMESPACE}"
assert_contains     "$DEV" "dev: temporal taskQueue=${DEV_NAMESPACE}-main"     "${DEV_NAMESPACE}-main"
assert_contains     "$DEV" "dev: secretKeyRef present"                  "secretKeyRef"
assert_contains     "$DEV" "dev: frontend secret=frontend-secrets-10x-stack-dev"       "frontend-secrets-10x-stack-dev"
assert_contains     "$DEV" "dev: worker secret=temporal-worker-secrets-10x-stack-dev"  "temporal-worker-secrets-10x-stack-dev"
assert_contains     "$DEV" "dev: ops-api health endpoint configured"    "/health"
assert_contains     "$DEV" "dev: NetworkPolicy enabled for dev profile"   "kind: NetworkPolicy"
assert_contains     "$DEV_VALUES" "dev values: frontend Supabase URL uses HTTPS"    "supabaseUrl: \"https://"
assert_contains     "$DEV_VALUES" "dev values: frontend API URL uses HTTPS"         "apiUrl: \"https://"
assert_not_contains "$DEV" "dev: VITE_SUPABASE_ANON_KEY not literal"   "value:.*VITE_SUPABASE_ANON_KEY"
assert_not_contains "$DEV" "dev: SUPABASE_SERVICE_ROLE_KEY not literal" "value:.*SUPABASE_SERVICE_ROLE_KEY"

# dev profile: scoped hardening guardrails for frontend and temporal-worker
DEV_FRONTEND_DEPLOY=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: Deployment/ && /component: frontend/' <<<"$DEV")
assert_contains "$DEV_FRONTEND_DEPLOY" "dev: frontend runAsNonRoot"              "runAsNonRoot: true"
assert_contains "$DEV_FRONTEND_DEPLOY" "dev: frontend runAsUser=10001"             "runAsUser: 10001"
assert_contains "$DEV_FRONTEND_DEPLOY" "dev: frontend seccomp RuntimeDefault"    "type: RuntimeDefault"
assert_contains "$DEV_FRONTEND_DEPLOY" "dev: frontend allowPrivilegeEscalation"  "allowPrivilegeEscalation: false"
assert_contains "$DEV_FRONTEND_DEPLOY" "dev: frontend readOnlyRootFilesystem"    "readOnlyRootFilesystem: true"
assert_contains "$DEV_FRONTEND_DEPLOY" "dev: frontend /tmp writable mount"       "mountPath: /tmp"
DEV_WORKER_DEPLOY=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: Deployment/ && /component: temporal-worker/' <<<"$DEV")
assert_contains "$DEV_WORKER_DEPLOY" "dev: temporal-worker runAsNonRoot"             "runAsNonRoot: true"
assert_contains "$DEV_WORKER_DEPLOY" "dev: temporal-worker runAsUser=10001"          "runAsUser: 10001"
assert_contains "$DEV_WORKER_DEPLOY" "dev: temporal-worker seccomp RuntimeDefault"   "type: RuntimeDefault"
assert_contains "$DEV_WORKER_DEPLOY" "dev: temporal-worker allowPrivilegeEscalation" "allowPrivilegeEscalation: false"
assert_contains "$DEV_WORKER_DEPLOY" "dev: temporal-worker readOnlyRootFilesystem"   "readOnlyRootFilesystem: true"
assert_contains "$DEV_WORKER_DEPLOY" "dev: temporal-worker /tmp writable mount"      "mountPath: /tmp"

# dev profile: live-env deploy wiring — acr-pull imagePullSecret, in-cluster Temporal, resource sizing
# These assertions guard the settings that keep the live dev environment working after PR #106/#407.
DEV_OPS_API_DEPLOY=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: Deployment/ && /component: ops-api/' <<<"$DEV")
assert_contains "$DEV_FRONTEND_DEPLOY" "dev: frontend imagePullSecrets=acr-pull"    "name: acr-pull"
assert_contains "$DEV_WORKER_DEPLOY"   "dev: temporal-worker imagePullSecrets=acr-pull" "name: acr-pull"
assert_contains "$DEV_OPS_API_DEPLOY"  "dev: ops-api imagePullSecrets=acr-pull"     "name: acr-pull"
assert_contains "$DEV_OPS_API_DEPLOY" "dev: ops-api temporal namespace=10x-stack-dev" "10x-stack-dev"
assert_contains "$DEV_WORKER_DEPLOY" "dev: temporal-worker temporal address=in-cluster svc" \
  "temporal-frontend\\.dev\\.svc\\.cluster\\.local:7233"
assert_contains "$DEV_OPS_API_DEPLOY" "dev: ops-api temporal address=in-cluster svc" \
  "temporal-frontend\\.dev\\.svc\\.cluster\\.local:7233"
assert_contains "$DEV_OPS_API_DEPLOY" "dev: ops-api temporal namespace=${DEV_NAMESPACE}" \
  "${DEV_NAMESPACE}"
assert_contains "$DEV_OPS_API_DEPLOY" "dev: ops-api HTTP_PORT env var injected" "HTTP_PORT"
assert_contains "$DEV_FRONTEND_DEPLOY" "dev: frontend memory request=512Mi"         "memory: 512Mi"
assert_contains "$DEV_FRONTEND_DEPLOY" "dev: frontend memory limit=1Gi"             "memory: 1Gi"
assert_contains "$DEV_FRONTEND_DEPLOY" "dev: frontend cpu request=100m"             "cpu: 100m"

# dev profile: replicaCount=1 for frontend and ops-api — no anti-affinity should be rendered
assert_not_contains "$DEV_FRONTEND_DEPLOY" "dev: frontend no podAntiAffinity with 1 replica" "podAntiAffinity:"
assert_not_contains "$DEV_OPS_API_DEPLOY"  "dev: ops-api no podAntiAffinity with 1 replica"  "podAntiAffinity:"

# dev profile: probe-type regression guard (kube-score CRITICAL #1012)
# Mirrors the base-profile guard to ensure liveness/readiness stay differentiated across all
# scanned profiles; kube-score tests base, dev, and test.
assert_contains "$DEV_FRONTEND_DEPLOY" "dev: frontend liveness probe uses tcpSocket" "tcpSocket:"
assert_contains "$DEV_FRONTEND_DEPLOY" "dev: frontend readiness probe uses httpGet"  "httpGet:"
assert_contains "$DEV_OPS_API_DEPLOY"  "dev: ops-api liveness probe uses tcpSocket"  "tcpSocket:"
assert_contains "$DEV_OPS_API_DEPLOY"  "dev: ops-api readiness probe uses httpGet"   "httpGet:"
assert_contains "$DEV_WORKER_DEPLOY"   "dev: temporal-worker liveness probe uses exec"          "kill -0 1"
assert_contains "$DEV_WORKER_DEPLOY"   "dev: temporal-worker readiness probe is disambiguated"  "2>/dev"

# dev profile: ExternalSecret disabled — Terraform owns ESO in dev (ADR-0072)
# values-dev.yaml sets externalSecrets.enabled: false because Terraform manages
# per-workload SecretStores and ExternalSecrets directly in the dev namespace.
assert_not_contains "$DEV" "dev: no chart-managed ExternalSecret in dev (Terraform owns ESO)" "kind: ExternalSecret"

# ── test profile ──────────────────────────────────────────────────────────────
echo ""
echo "=== values-test.yaml ==="
TEST=$(helm template "$RELEASE" "$CHART" -f "$CHART/values-test.yaml")

assert_contains     "$TEST" "test: frontend Deployment renders"          "kind: Deployment"
assert_contains     "$TEST" "test: frontend replicas=2"                  "replicas: 2"
assert_contains     "$TEST" "test: Ingress enabled"                      "kind: Ingress"
assert_contains     "$TEST" "test: ingress host=frontend.<TEST_DOMAIN>"  "frontend\\.<TEST_DOMAIN>"
assert_contains     "$TEST" "test: ingress className=nginx"              "ingressClassName: nginx"
assert_contains     "$TEST" "test: frontend image tag prefix=test-"      "/frontend:test-"
assert_contains     "$TEST" "test: worker image tag prefix=test-"        "/temporal-worker:test-"
assert_contains     "$TEST" "test: ops-api image tag prefix=test-"       "/temporal-worker:test-"
assert_contains     "$TEST" "test: temporal namespace=10x-stack-test"        "10x-stack-test"
assert_contains     "$TEST" "test: temporal taskQueue=10x-stack-test-main"   "10x-stack-test-main"
assert_contains     "$TEST" "test: secretKeyRef present"                 "secretKeyRef"
assert_contains     "$TEST" "test: frontend secret=frontend-secrets-10x-stack-test"       "frontend-secrets-10x-stack-test"
assert_contains     "$TEST" "test: worker secret=temporal-worker-secrets-10x-stack-test"  "temporal-worker-secrets-10x-stack-test"
assert_contains     "$TEST" "test: default-deny NetworkPolicy present"         "name: default-deny-all"
assert_contains     "$TEST" "test: frontend NetworkPolicy present"             "name: frontend-policy"
assert_contains     "$TEST" "test: worker NetworkPolicy present"               "name: temporal-worker-policy"
assert_contains     "$TEST" "test: ops-api NetworkPolicy present"              "name: ops-api-policy"
TEST_DEFAULT_DENY_POLICY=$(extract_named_doc "$TEST" "NetworkPolicy" "default-deny-all")
TEST_FRONTEND_POLICY=$(extract_named_doc "$TEST" "NetworkPolicy" "frontend-policy")
TEST_WORKER_POLICY=$(extract_named_doc "$TEST" "NetworkPolicy" "temporal-worker-policy")
TEST_OPS_API_POLICY=$(extract_named_doc "$TEST" "NetworkPolicy" "ops-api-policy")
assert_doc_present  "$TEST_DEFAULT_DENY_POLICY" "test: default-deny policy extracted"
assert_doc_present  "$TEST_FRONTEND_POLICY" "test: frontend policy extracted"
assert_doc_present  "$TEST_WORKER_POLICY" "test: worker policy extracted"
assert_doc_present  "$TEST_OPS_API_POLICY" "test: ops-api policy extracted"
assert_contains     "$TEST_DEFAULT_DENY_POLICY" "test: default-deny has Ingress policy type" "- Ingress"
assert_contains     "$TEST_DEFAULT_DENY_POLICY" "test: default-deny has Egress policy type" "- Egress"
assert_contains     "$TEST_FRONTEND_POLICY" "test: frontend policy allows ingress from ingress-nginx namespace" \
  "kubernetes\\.io/metadata\\.name: \"?ingress-nginx\"?"
assert_contains     "$TEST_FRONTEND_POLICY" "test: frontend policy has Ingress policy type" "- Ingress"
assert_contains     "$TEST_FRONTEND_POLICY" "test: frontend policy has Egress policy type" "- Egress"
assert_contains     "$TEST_FRONTEND_POLICY" "test: frontend policy includes DNS egress port" "- port: 53"
assert_contains     "$TEST_FRONTEND_POLICY" "test: frontend policy allows UDP DNS egress" "protocol: UDP"
assert_contains     "$TEST_FRONTEND_POLICY" "test: frontend policy allows TCP DNS egress" "protocol: TCP"
assert_port_count   "$TEST_FRONTEND_POLICY" "test: frontend policy only allows DNS egress ports" 2
assert_contains     "$TEST_WORKER_POLICY" "test: worker policy denies ingress" "ingress: \\[\\]"
assert_contains     "$TEST_WORKER_POLICY" "test: worker policy has Ingress policy type" "- Ingress"
assert_contains     "$TEST_WORKER_POLICY" "test: worker policy has Egress policy type" "- Egress"
assert_contains     "$TEST_WORKER_POLICY" "test: worker policy allows TCP 443 egress" "- port: 443"
assert_contains     "$TEST_WORKER_POLICY" "test: worker policy allows TCP 7233 egress" "- port: 7233"
assert_contains     "$TEST_WORKER_POLICY" "test: worker policy allows TCP 8000 egress" "- port: 8000"
assert_contains     "$TEST_WORKER_POLICY" "test: worker policy includes DNS egress port" "- port: 53"
assert_contains     "$TEST_WORKER_POLICY" "test: worker policy allows UDP DNS egress" "protocol: UDP"
assert_contains     "$TEST_WORKER_POLICY" "test: worker policy allows TCP DNS egress" "protocol: TCP"
assert_port_count   "$TEST_WORKER_POLICY" "test: worker policy only allows DNS/8000/443/7233 egress ports" 5
assert_contains     "$TEST_OPS_API_POLICY" "test: ops-api policy denies ingress" "ingress: \\[\\]"
assert_contains     "$TEST_OPS_API_POLICY" "test: ops-api policy has Ingress policy type" "- Ingress"
assert_contains     "$TEST_OPS_API_POLICY" "test: ops-api policy has Egress policy type" "- Egress"
assert_contains     "$TEST_OPS_API_POLICY" "test: ops-api policy allows TCP 443 egress" "- port: 443"
assert_contains     "$TEST_OPS_API_POLICY" "test: ops-api policy allows TCP 7233 egress" "- port: 7233"
assert_contains     "$TEST_OPS_API_POLICY" "test: ops-api policy allows TCP 8000 egress" "- port: 8000"
assert_contains     "$TEST_OPS_API_POLICY" "test: ops-api policy includes DNS egress port" "- port: 53"
assert_contains     "$TEST_OPS_API_POLICY" "test: ops-api policy allows UDP DNS egress" "protocol: UDP"
assert_contains     "$TEST_OPS_API_POLICY" "test: ops-api policy allows TCP DNS egress" "protocol: TCP"
assert_port_count   "$TEST_OPS_API_POLICY" "test: ops-api policy only allows DNS/8000/443/7233 egress ports" 5
assert_not_contains "$TEST" "test: VITE_SUPABASE_ANON_KEY not literal"   "value:.*VITE_SUPABASE_ANON_KEY"
assert_not_contains "$TEST" "test: SUPABASE_SERVICE_ROLE_KEY not literal" "value:.*SUPABASE_SERVICE_ROLE_KEY"

# test profile: scoped hardening guardrails for frontend and temporal-worker
TEST_FRONTEND_DEPLOY=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: Deployment/ && /component: frontend/' <<<"$TEST")
assert_contains "$TEST_FRONTEND_DEPLOY" "test: frontend runAsNonRoot"              "runAsNonRoot: true"
assert_contains "$TEST_FRONTEND_DEPLOY" "test: frontend runAsUser=10001"             "runAsUser: 10001"
assert_contains "$TEST_FRONTEND_DEPLOY" "test: frontend seccomp RuntimeDefault"    "type: RuntimeDefault"
assert_contains "$TEST_FRONTEND_DEPLOY" "test: frontend allowPrivilegeEscalation"  "allowPrivilegeEscalation: false"
assert_contains "$TEST_FRONTEND_DEPLOY" "test: frontend readOnlyRootFilesystem"    "readOnlyRootFilesystem: true"
assert_contains "$TEST_FRONTEND_DEPLOY" "test: frontend /tmp writable mount"       "mountPath: /tmp"
TEST_WORKER_DEPLOY=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: Deployment/ && /component: temporal-worker/' <<<"$TEST")
assert_contains "$TEST_WORKER_DEPLOY" "test: temporal-worker runAsNonRoot"             "runAsNonRoot: true"
assert_contains "$TEST_WORKER_DEPLOY" "test: temporal-worker runAsUser=10001"          "runAsUser: 10001"
assert_contains "$TEST_WORKER_DEPLOY" "test: temporal-worker seccomp RuntimeDefault"   "type: RuntimeDefault"
assert_contains "$TEST_WORKER_DEPLOY" "test: temporal-worker allowPrivilegeEscalation" "allowPrivilegeEscalation: false"
assert_contains "$TEST_WORKER_DEPLOY" "test: temporal-worker readOnlyRootFilesystem"   "readOnlyRootFilesystem: true"
assert_contains "$TEST_WORKER_DEPLOY" "test: temporal-worker /tmp writable mount"      "mountPath: /tmp"
assert_contains     "$TEST" "test: frontend PDB present"                "kind: PodDisruptionBudget"
assert_contains     "$TEST" "test: frontend PDB name"                   "name: ${RELEASE}-app-frontend"
assert_contains     "$TEST" "test: worker PDB name"                     "name: ${RELEASE}-app-temporal-worker"
assert_contains     "$TEST" "test: ops-api PDB name"                    "name: ${RELEASE}-app-ops-api"
assert_not_contains "$TEST" "test: HPA disabled"                        "kind: HorizontalPodAutoscaler"

# test profile: pod anti-affinity — frontend has 2 replicas, must spread across nodes (kube-score best practice)
assert_contains "$TEST_FRONTEND_DEPLOY" "test: frontend podAntiAffinity set (kube-score)"      "podAntiAffinity:"
assert_contains "$TEST_FRONTEND_DEPLOY" "test: frontend anti-affinity topology=hostname"       "topologyKey: kubernetes\\.io/hostname"
assert_contains "$TEST_FRONTEND_DEPLOY" "test: frontend anti-affinity uses preferred scheduling" "preferredDuringSchedulingIgnoredDuringExecution"

# test profile: ops-api has replicaCount=1 — no anti-affinity should be rendered
TEST_OPS_API_DEPLOY=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: Deployment/ && /component: ops-api/' <<<"$TEST")
assert_not_contains "$TEST_OPS_API_DEPLOY" "test: ops-api no podAntiAffinity with 1 replica" "podAntiAffinity:"

# test profile: probe-type regression guard (kube-score CRITICAL #1012)
# kube-score scans the test profile; ensure liveness/readiness are differentiated here too.
assert_contains "$TEST_FRONTEND_DEPLOY" "test: frontend liveness probe uses tcpSocket" "tcpSocket:"
assert_contains "$TEST_FRONTEND_DEPLOY" "test: frontend readiness probe uses httpGet"  "httpGet:"
assert_contains "$TEST_OPS_API_DEPLOY"  "test: ops-api liveness probe uses tcpSocket"  "tcpSocket:"
assert_contains "$TEST_OPS_API_DEPLOY"  "test: ops-api readiness probe uses httpGet"   "httpGet:"
assert_contains "$TEST_WORKER_DEPLOY"   "test: temporal-worker liveness probe uses exec"          "kill -0 1"
assert_contains "$TEST_WORKER_DEPLOY"   "test: temporal-worker readiness probe is disambiguated"  "2>/dev"

# test profile: ExternalSecret assertions (ADR-0042)
assert_contains     "$TEST" "test: ExternalSecret rendered when enabled"           "kind: ExternalSecret"
assert_contains     "$TEST" "test: ExternalSecret uses openbao-test secretStoreRef" "name:.*openbao-test"
assert_contains     "$TEST" "test: ExternalSecret frontend target name"            "name: frontend-secrets-10x-stack-test"
assert_contains     "$TEST" "test: ExternalSecret worker target name"              "name: temporal-worker-secrets-10x-stack-test"
assert_contains     "$TEST" "test: ExternalSecret frontend KV path"                "secret/data/project-template/test/frontend"
assert_contains     "$TEST" "test: ExternalSecret backend KV path"                 "secret/data/project-template/test/backend"

# ── prod profile ──────────────────────────────────────────────────────────────
echo ""
echo "=== values-prod.yaml ==="
PROD=$(helm template "$RELEASE" "$CHART" -f "$CHART/values-prod.yaml")
PROD_FRONTEND_DEPLOY=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: Deployment/ && /component: frontend/' <<<"$PROD")
PROD_WORKER_DEPLOY=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: Deployment/ && /component: temporal-worker/' <<<"$PROD")

assert_contains     "$PROD" "prod: frontend Deployment renders"          "kind: Deployment"
assert_contains     "$PROD" "prod: ops-api replicas=2"                   "replicas: 2"
assert_not_contains "$PROD_FRONTEND_DEPLOY" "prod: no static frontend replicas (HPA manages)" "replicas:"
assert_not_contains "$PROD_WORKER_DEPLOY"   "prod: no static worker replicas (HPA manages)"   "replicas:"
assert_contains     "$PROD" "prod: Ingress enabled"                      "kind: Ingress"
assert_contains     "$PROD" "prod: ingress host=frontend.<PROD_DOMAIN>"  "frontend\\.<PROD_DOMAIN>"
assert_contains     "$PROD" "prod: ingress className=nginx"              "ingressClassName: nginx"
assert_contains     "$PROD" "prod: frontend image tag prefix=prod-"      "/frontend:prod-"
assert_contains     "$PROD" "prod: worker image tag prefix=prod-"        "/temporal-worker:prod-"
assert_contains     "$PROD" "prod: ops-api image tag prefix=prod-"       "/temporal-worker:prod-"
assert_contains     "$PROD" "prod: frontend HPA present"                 "kind: HorizontalPodAutoscaler"
assert_contains     "$PROD" "prod: frontend HPA name"                    "name: ${RELEASE}-app-frontend"
assert_contains     "$PROD" "prod: worker HPA name"                      "name: ${RELEASE}-app-temporal-worker"
assert_contains     "$PROD" "prod: frontend HPA minReplicas=3"           "minReplicas: 3"
assert_contains     "$PROD" "prod: frontend HPA maxReplicas=10"          "maxReplicas: 10"
assert_contains     "$PROD" "prod: frontend HPA target=70"               "averageUtilization: 70"
assert_contains     "$PROD" "prod: worker HPA minReplicas=2"             "minReplicas: 2"
assert_contains     "$PROD" "prod: worker HPA maxReplicas=5"             "maxReplicas: 5"
assert_contains     "$PROD" "prod: worker HPA target=70"                 "averageUtilization: 70"
assert_contains     "$PROD" "prod: frontend PDB present"                 "kind: PodDisruptionBudget"
assert_contains     "$PROD" "prod: frontend PDB minAvailable=2"          "minAvailable: 2"
assert_contains     "$PROD" "prod: worker PDB minAvailable=1"            "minAvailable: 1"
assert_contains     "$PROD" "prod: ops-api PDB name"                     "name: ${RELEASE}-app-ops-api"
assert_contains     "$PROD" "prod: temporal namespace=<PROD_NAMESPACE>"        "<PROD_NAMESPACE>"
assert_contains     "$PROD" "prod: temporal taskQueue=<PROD_NAMESPACE>-main"   "<PROD_NAMESPACE>-main"
assert_contains     "$PROD" "prod: secretKeyRef present"                 "secretKeyRef"
assert_contains     "$PROD" "prod: frontend secret=frontend-secrets-<PROD_NAMESPACE>"       "frontend-secrets-<PROD_NAMESPACE>"
assert_contains     "$PROD" "prod: worker secret=temporal-worker-secrets-<PROD_NAMESPACE>"  "temporal-worker-secrets-<PROD_NAMESPACE>"
assert_contains     "$PROD" "prod: default-deny NetworkPolicy present"         "name: default-deny-all"
assert_contains     "$PROD" "prod: frontend NetworkPolicy present"             "name: frontend-policy"
assert_contains     "$PROD" "prod: worker NetworkPolicy present"               "name: temporal-worker-policy"
assert_contains     "$PROD" "prod: ops-api NetworkPolicy present"              "name: ops-api-policy"
PROD_DEFAULT_DENY_POLICY=$(extract_named_doc "$PROD" "NetworkPolicy" "default-deny-all")
PROD_FRONTEND_POLICY=$(extract_named_doc "$PROD" "NetworkPolicy" "frontend-policy")
PROD_WORKER_POLICY=$(extract_named_doc "$PROD" "NetworkPolicy" "temporal-worker-policy")
PROD_OPS_API_POLICY=$(extract_named_doc "$PROD" "NetworkPolicy" "ops-api-policy")
assert_doc_present  "$PROD_DEFAULT_DENY_POLICY" "prod: default-deny policy extracted"
assert_doc_present  "$PROD_FRONTEND_POLICY" "prod: frontend policy extracted"
assert_doc_present  "$PROD_WORKER_POLICY" "prod: worker policy extracted"
assert_doc_present  "$PROD_OPS_API_POLICY" "prod: ops-api policy extracted"
assert_contains     "$PROD_DEFAULT_DENY_POLICY" "prod: default-deny has Ingress policy type" "- Ingress"
assert_contains     "$PROD_DEFAULT_DENY_POLICY" "prod: default-deny has Egress policy type" "- Egress"
assert_contains     "$PROD_FRONTEND_POLICY" "prod: frontend policy allows ingress from ingress-nginx namespace" \
  "kubernetes\\.io/metadata\\.name: \"?ingress-nginx\"?"
assert_contains     "$PROD_FRONTEND_POLICY" "prod: frontend policy has Ingress policy type" "- Ingress"
assert_contains     "$PROD_FRONTEND_POLICY" "prod: frontend policy has Egress policy type" "- Egress"
assert_contains     "$PROD_FRONTEND_POLICY" "prod: frontend policy includes DNS egress port" "- port: 53"
assert_contains     "$PROD_FRONTEND_POLICY" "prod: frontend policy allows UDP DNS egress" "protocol: UDP"
assert_contains     "$PROD_FRONTEND_POLICY" "prod: frontend policy allows TCP DNS egress" "protocol: TCP"
assert_port_count   "$PROD_FRONTEND_POLICY" "prod: frontend policy only allows DNS egress ports" 2
assert_contains     "$PROD_WORKER_POLICY" "prod: worker policy denies ingress" "ingress: \\[\\]"
assert_contains     "$PROD_WORKER_POLICY" "prod: worker policy has Ingress policy type" "- Ingress"
assert_contains     "$PROD_WORKER_POLICY" "prod: worker policy has Egress policy type" "- Egress"
assert_contains     "$PROD_WORKER_POLICY" "prod: worker policy allows TCP 443 egress" "- port: 443"
assert_contains     "$PROD_WORKER_POLICY" "prod: worker policy allows TCP 7233 egress" "- port: 7233"
assert_contains     "$PROD_WORKER_POLICY" "prod: worker policy allows TCP 8000 egress" "- port: 8000"
assert_contains     "$PROD_WORKER_POLICY" "prod: worker policy includes DNS egress port" "- port: 53"
assert_contains     "$PROD_WORKER_POLICY" "prod: worker policy allows UDP DNS egress" "protocol: UDP"
assert_contains     "$PROD_WORKER_POLICY" "prod: worker policy allows TCP DNS egress" "protocol: TCP"
assert_port_count   "$PROD_WORKER_POLICY" "prod: worker policy only allows DNS/8000/443/7233 egress ports" 5
assert_contains     "$PROD_OPS_API_POLICY" "prod: ops-api policy denies ingress" "ingress: \\[\\]"
assert_contains     "$PROD_OPS_API_POLICY" "prod: ops-api policy has Ingress policy type" "- Ingress"
assert_contains     "$PROD_OPS_API_POLICY" "prod: ops-api policy has Egress policy type" "- Egress"
assert_contains     "$PROD_OPS_API_POLICY" "prod: ops-api policy allows TCP 443 egress" "- port: 443"
assert_contains     "$PROD_OPS_API_POLICY" "prod: ops-api policy allows TCP 7233 egress" "- port: 7233"
assert_contains     "$PROD_OPS_API_POLICY" "prod: ops-api policy allows TCP 8000 egress" "- port: 8000"
assert_contains     "$PROD_OPS_API_POLICY" "prod: ops-api policy includes DNS egress port" "- port: 53"
assert_contains     "$PROD_OPS_API_POLICY" "prod: ops-api policy allows UDP DNS egress" "protocol: UDP"
assert_contains     "$PROD_OPS_API_POLICY" "prod: ops-api policy allows TCP DNS egress" "protocol: TCP"
assert_port_count   "$PROD_OPS_API_POLICY" "prod: ops-api policy only allows DNS/8000/443/7233 egress ports" 5
assert_not_contains "$PROD" "prod: VITE_SUPABASE_ANON_KEY not literal"   "value:.*VITE_SUPABASE_ANON_KEY"
assert_not_contains "$PROD" "prod: SUPABASE_SERVICE_ROLE_KEY not literal" "value:.*SUPABASE_SERVICE_ROLE_KEY"

# prod profile: scoped hardening guardrails for frontend and temporal-worker
PROD_FRONTEND_DEPLOY=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: Deployment/ && /component: frontend/' <<<"$PROD")
assert_contains "$PROD_FRONTEND_DEPLOY" "prod: frontend runAsNonRoot"              "runAsNonRoot: true"
assert_contains "$PROD_FRONTEND_DEPLOY" "prod: frontend runAsUser=10001"             "runAsUser: 10001"
assert_contains "$PROD_FRONTEND_DEPLOY" "prod: frontend seccomp RuntimeDefault"    "type: RuntimeDefault"
assert_contains "$PROD_FRONTEND_DEPLOY" "prod: frontend allowPrivilegeEscalation"  "allowPrivilegeEscalation: false"
assert_contains "$PROD_FRONTEND_DEPLOY" "prod: frontend readOnlyRootFilesystem"    "readOnlyRootFilesystem: true"
assert_contains "$PROD_FRONTEND_DEPLOY" "prod: frontend /tmp writable mount"       "mountPath: /tmp"

# prod profile: pod anti-affinity — frontend has 3 replicas, ops-api has 2; both must spread (kube-score best practice)
assert_contains "$PROD_FRONTEND_DEPLOY" "prod: frontend podAntiAffinity set (kube-score)"       "podAntiAffinity:"
assert_contains "$PROD_FRONTEND_DEPLOY" "prod: frontend anti-affinity topology=hostname"        "topologyKey: kubernetes\\.io/hostname"
PROD_OPS_API_DEPLOY=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: Deployment/ && /component: ops-api/' <<<"$PROD")
assert_contains "$PROD_OPS_API_DEPLOY"  "prod: ops-api podAntiAffinity set (kube-score)"        "podAntiAffinity:"
assert_contains "$PROD_OPS_API_DEPLOY"  "prod: ops-api anti-affinity topology=hostname"         "topologyKey: kubernetes\\.io/hostname"

PROD_WORKER_DEPLOY=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: Deployment/ && /component: temporal-worker/' <<<"$PROD")
assert_contains "$PROD_WORKER_DEPLOY" "prod: temporal-worker runAsNonRoot"             "runAsNonRoot: true"
assert_contains "$PROD_WORKER_DEPLOY" "prod: temporal-worker runAsUser=10001"          "runAsUser: 10001"
assert_contains "$PROD_WORKER_DEPLOY" "prod: temporal-worker seccomp RuntimeDefault"   "type: RuntimeDefault"
assert_contains "$PROD_WORKER_DEPLOY" "prod: temporal-worker allowPrivilegeEscalation" "allowPrivilegeEscalation: false"
assert_contains "$PROD_WORKER_DEPLOY" "prod: temporal-worker readOnlyRootFilesystem"   "readOnlyRootFilesystem: true"
assert_contains "$PROD_WORKER_DEPLOY" "prod: temporal-worker /tmp writable mount"      "mountPath: /tmp"

# prod profile: probe-type regression guard (kube-score CRITICAL #1012)
assert_contains "$PROD_FRONTEND_DEPLOY" "prod: frontend liveness probe uses tcpSocket" "tcpSocket:"
assert_contains "$PROD_FRONTEND_DEPLOY" "prod: frontend readiness probe uses httpGet"  "httpGet:"
assert_contains "$PROD_OPS_API_DEPLOY"  "prod: ops-api liveness probe uses tcpSocket"  "tcpSocket:"
assert_contains "$PROD_OPS_API_DEPLOY"  "prod: ops-api readiness probe uses httpGet"   "httpGet:"
assert_contains "$PROD_WORKER_DEPLOY"   "prod: temporal-worker liveness probe uses exec"          "kill -0 1"
assert_contains "$PROD_WORKER_DEPLOY"   "prod: temporal-worker readiness probe is disambiguated"  "2>/dev"

# prod profile: ExternalSecret assertions (ADR-0042)
assert_contains     "$PROD" "prod: ExternalSecret rendered when enabled"            "kind: ExternalSecret"
assert_contains     "$PROD" "prod: ExternalSecret uses openbao-prod secretStoreRef" "name:.*openbao-prod"
assert_contains     "$PROD" "prod: ExternalSecret frontend KV path"                 "secret/data/project-template/prod/frontend"
assert_contains     "$PROD" "prod: ExternalSecret backend KV path"                  "secret/data/project-template/prod/backend"

# ── aws-dev profile ───────────────────────────────────────────────────────────
echo ""
echo "=== values-aws-dev.yaml ==="
AWS_DEV=$(helm template "$RELEASE" "$CHART" -f "$CHART/values-aws-dev.yaml")

assert_contains "$AWS_DEV" "aws-dev: frontend Deployment renders" "kind: Deployment"

AWS_DEV_FRONTEND_DEPLOY=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: Deployment/ && /component: frontend/' <<<"$AWS_DEV")
AWS_DEV_WORKER_DEPLOY=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: Deployment/ && /component: temporal-worker/' <<<"$AWS_DEV")
AWS_DEV_OPS_API_DEPLOY=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: Deployment/ && /component: ops-api/' <<<"$AWS_DEV")

# aws-dev uses ECR via node IAM role — no imagePullSecrets should be present
assert_not_contains "$AWS_DEV_FRONTEND_DEPLOY" "aws-dev: frontend no imagePullSecrets (ECR via node IAM)" "imagePullSecrets:"
assert_not_contains "$AWS_DEV_WORKER_DEPLOY"   "aws-dev: worker no imagePullSecrets (ECR via node IAM)"   "imagePullSecrets:"
assert_not_contains "$AWS_DEV_OPS_API_DEPLOY"  "aws-dev: ops-api no imagePullSecrets (ECR via node IAM)"  "imagePullSecrets:"

# aws-dev frontend service uses NLB on EKS
AWS_DEV_FRONTEND_SERVICE=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: Service/ && /app.kubernetes.io\/component: frontend/' <<<"$AWS_DEV")
assert_contains "$AWS_DEV_FRONTEND_SERVICE" "aws-dev: frontend service type=LoadBalancer" "type: LoadBalancer"
assert_contains "$AWS_DEV_FRONTEND_SERVICE" "aws-dev: frontend service uses NLB annotation" "aws-load-balancer-type"

# aws-dev: ExternalSecret disabled — Terraform owns ESO in aws-dev (same pattern as azure-dev)
assert_not_contains "$AWS_DEV" "aws-dev: no chart-managed ExternalSecret (Terraform owns ESO)" "kind: ExternalSecret"

# aws-dev profile: probe-type regression guard (kube-score CRITICAL #1012)
# aws-dev explicitly overrides frontend probes; opsApi and temporalWorker inherit from base.
assert_contains "$AWS_DEV_FRONTEND_DEPLOY" "aws-dev: frontend liveness probe uses tcpSocket" "tcpSocket:"
assert_contains "$AWS_DEV_FRONTEND_DEPLOY" "aws-dev: frontend readiness probe uses httpGet"  "httpGet:"
assert_contains "$AWS_DEV_OPS_API_DEPLOY"  "aws-dev: ops-api liveness probe uses tcpSocket"  "tcpSocket:"
assert_contains "$AWS_DEV_OPS_API_DEPLOY"  "aws-dev: ops-api readiness probe uses httpGet"   "httpGet:"
assert_contains "$AWS_DEV_WORKER_DEPLOY"   "aws-dev: temporal-worker liveness probe uses exec"          "kill -0 1"
assert_contains "$AWS_DEV_WORKER_DEPLOY"   "aws-dev: temporal-worker readiness probe is disambiguated"  "2>/dev"

# ── azure-dev profile ─────────────────────────────────────────────────────────
echo ""
echo "=== values-azure-dev.yaml ==="
AZURE_DEV=$(helm template "$RELEASE" "$CHART" -f "$CHART/values-azure-dev.yaml")

assert_contains "$AZURE_DEV" "azure-dev: frontend Deployment renders" "kind: Deployment"

AZURE_DEV_FRONTEND_DEPLOY=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: Deployment/ && /component: frontend/' <<<"$AZURE_DEV")
AZURE_DEV_WORKER_DEPLOY=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: Deployment/ && /component: temporal-worker/' <<<"$AZURE_DEV")
AZURE_DEV_OPS_API_DEPLOY=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: Deployment/ && /component: ops-api/' <<<"$AZURE_DEV")

# azure-dev frontend uses port 80 externally (AKS NSG-friendly) and containerPort 8080
AZURE_DEV_FRONTEND_SERVICE=$(awk 'BEGIN{RS="---\n"; ORS=""} /kind: Service/ && /app.kubernetes.io\/component: frontend/' <<<"$AZURE_DEV")
assert_contains "$AZURE_DEV_FRONTEND_SERVICE" "azure-dev: frontend service port=80"   "port: 80"
assert_contains "$AZURE_DEV_FRONTEND_DEPLOY"  "azure-dev: frontend containerPort=8080" "containerPort: 8080"

# azure-dev: ExternalSecret disabled — Terraform owns ESO in azure-dev
assert_not_contains "$AZURE_DEV" "azure-dev: no chart-managed ExternalSecret (Terraform owns ESO)" "kind: ExternalSecret"

# azure-dev profile: probe-type regression guard (kube-score CRITICAL #1012)
# azure-dev explicitly overrides frontend probes; opsApi and temporalWorker inherit from base.
assert_contains "$AZURE_DEV_FRONTEND_DEPLOY" "azure-dev: frontend liveness probe uses tcpSocket" "tcpSocket:"
assert_contains "$AZURE_DEV_FRONTEND_DEPLOY" "azure-dev: frontend readiness probe uses httpGet"  "httpGet:"
assert_contains "$AZURE_DEV_OPS_API_DEPLOY"  "azure-dev: ops-api liveness probe uses tcpSocket"  "tcpSocket:"
assert_contains "$AZURE_DEV_OPS_API_DEPLOY"  "azure-dev: ops-api readiness probe uses httpGet"   "httpGet:"
assert_contains "$AZURE_DEV_WORKER_DEPLOY"   "azure-dev: temporal-worker liveness probe uses exec"          "kill -0 1"
assert_contains "$AZURE_DEV_WORKER_DEPLOY"   "azure-dev: temporal-worker readiness probe is disambiguated"  "2>/dev"

# ── deploy-dev.yml workflow assertions ────────────────────────────────────────
# Deterministic CI-local checks that the deploy workflow still wires the required
# dev secrets, values file, and image-tag overrides after the live-dev changes
# introduced in PR #106 and extended in PR #407.
#
# Assertions are scoped to the specific named step blocks — not whole-file grep —
# so a mention in a comment or another step cannot satisfy them.
echo ""
echo "=== deploy-dev.yml workflow assertions ==="
WORKFLOW_FILE=".github/workflows/deploy-dev.yml"
if [ ! -f "$WORKFLOW_FILE" ]; then
  fail "workflow: deploy-dev.yml exists at .github/workflows/deploy-dev.yml"
else
  pass "workflow: deploy-dev.yml exists"

  # Extract the deploy job's kubeconfig-configure step (stops at the next step header).
  KUBECONFIG_STEP=$(awk '
    /^      - name: Configure kubeconfig \(namespace-scoped gha-deployer\)/{capturing=1; print; next}
    capturing && /^      - name: /{capturing=0}
    capturing{print}
  ' "$WORKFLOW_FILE")

  # Extract the Helm upgrade step (stops at next step header or new job key).
  HELM_UPGRADE_STEP=$(awk '
    /^      - name: Helm upgrade \(10x-stack-dev\)/{capturing=1; print; next}
    capturing && (/^  [a-z]/ || /^      - name: /){capturing=0}
    capturing{print}
  ' "$WORKFLOW_FILE")

  if [ -z "$KUBECONFIG_STEP" ]; then
    fail "workflow: 'Configure kubeconfig (namespace-scoped gha-deployer)' step extracted"
  else
    pass "workflow: 'Configure kubeconfig (namespace-scoped gha-deployer)' step extracted"
    assert_contains "$KUBECONFIG_STEP" "workflow: configure step writes KUBE_CONFIG_DEV to kubeconfig" \
      'secrets\.KUBE_CONFIG_DEV'
  fi

  if [ -z "$HELM_UPGRADE_STEP" ]; then
    fail "workflow: 'Helm upgrade (10x-stack-dev)' step extracted"
  else
    pass "workflow: 'Helm upgrade (10x-stack-dev)' step extracted"
    assert_contains "$HELM_UPGRADE_STEP" "workflow: helm upgrade step uses values-dev.yaml"              "charts/app/values-dev\\.yaml"
    assert_contains "$HELM_UPGRADE_STEP" "workflow: helm upgrade step sets frontend.image.tag"           "frontend\\.image\\.tag"
    assert_contains "$HELM_UPGRADE_STEP" "workflow: helm upgrade step sets temporalWorker.image.tag"     "temporalWorker\\.image\\.tag"
    assert_contains "$HELM_UPGRADE_STEP" "workflow: helm upgrade step sets opsApi.image.tag"             "opsApi\\.image\\.tag"
  fi
fi

# ── summary ───────────────────────────────────────────────────────────────────
echo ""
echo "=== Summary: ${PASS} passed, ${FAIL} failed ==="

# Optional machine-readable summary for the CI test-trend history (ci-history branch).
# Written only when CI_HISTORY_JSON points somewhere; default behavior is unchanged.
if [ -n "${CI_HISTORY_JSON:-}" ]; then
  outcome=passed
  [ "$FAIL" -ne 0 ] && outcome=failed
  printf '{"outcome":"%s","expected":%d,"unexpected":%d}\n' "$outcome" "$PASS" "$FAIL" > "$CI_HISTORY_JSON"
fi

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
