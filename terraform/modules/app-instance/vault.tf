# ---------------------------------------------------------------------------
# OpenBao — per-app single-node bootstrap with Kubernetes auth
# ---------------------------------------------------------------------------

resource "kubernetes_service_account" "openbao" {
  metadata {
    name      = "openbao"
    namespace = kubernetes_namespace.vault.metadata[0].name
    labels    = local.common_labels
  }
}

# OpenBao needs to call the Kubernetes TokenReview API to validate SA tokens.
resource "kubernetes_cluster_role_binding" "openbao_tokenreview" {
  metadata {
    name   = "openbao-tokenreview-${local.app_ns}"
    labels = local.common_labels
  }
  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "ClusterRole"
    name      = "system:auth-delegator"
  }
  subject {
    kind      = "ServiceAccount"
    name      = kubernetes_service_account.openbao.metadata[0].name
    namespace = kubernetes_namespace.vault.metadata[0].name
  }
}

resource "kubernetes_config_map_v1" "openbao_config" {
  metadata {
    name      = "openbao-config"
    namespace = kubernetes_namespace.vault.metadata[0].name
    labels    = local.common_labels
  }

  data = {
    "server.hcl" = <<-EOT
      ui = false
      disable_mlock = true

      listener "tcp" {
        address     = "0.0.0.0:8200"
        tls_disable = 1
      }

      storage "file" {
        path = "/openbao/data"
      }

      api_addr     = "${local.openbao_url}"
      cluster_addr = "http://127.0.0.1:8201"
    EOT
  }
}

resource "kubernetes_persistent_volume_claim_v1" "openbao_data" {
  metadata {
    name      = "openbao-data"
    namespace = kubernetes_namespace.vault.metadata[0].name
    labels    = local.common_labels
  }

  spec {
    access_modes = ["ReadWriteOnce"]
    resources {
      requests = {
        storage = var.openbao_data_size
      }
    }
    storage_class_name = var.openbao_storage_class
  }

  # WaitForFirstConsumer storage classes (default on AKS) only bind when a pod
  # is scheduled, so Terraform must not wait for Bound state here.
  wait_until_bound = false
}

resource "kubernetes_deployment" "openbao" {
  metadata {
    name      = "openbao"
    namespace = kubernetes_namespace.vault.metadata[0].name
    labels    = merge(local.common_labels, { "app" = "openbao" })
  }

  spec {
    replicas = 1
    selector {
      match_labels = { "app" = "openbao" }
    }
    template {
      metadata {
        labels = merge(local.common_labels, { "app" = "openbao" })
      }
      spec {
        service_account_name = kubernetes_service_account.openbao.metadata[0].name
        security_context {
          # PVC mounts as root:root; fsGroup ensures the openbao process (gid=1000)
          # can write to /openbao/data.
          fs_group = 1000
        }
        init_container {
          name  = "fix-permissions"
          image = "busybox:1.36"
          command = ["sh", "-c", "chown -R 100:1000 /openbao/data"]
          volume_mount {
            name       = "data"
            mount_path = "/openbao/data"
          }
          security_context {
            run_as_user = 0
          }
        }
        container {
          name  = "openbao"
          image = var.openbao_image
          args  = ["server", "-config=/openbao/config/server.hcl"]
          port {
            container_port = 8200
          }
          liveness_probe {
            http_get {
              path = "/v1/sys/health?standbyok=true&sealedcode=204&uninitcode=204"
              port = 8200
            }
            initial_delay_seconds = 10
            period_seconds        = 15
          }
          readiness_probe {
            http_get {
              path = "/v1/sys/health?standbyok=true&sealedcode=204&uninitcode=204"
              port = 8200
            }
            initial_delay_seconds = 5
            period_seconds        = 10
          }
          volume_mount {
            name       = "config"
            mount_path = "/openbao/config"
            read_only  = true
          }
          volume_mount {
            name       = "data"
            mount_path = "/openbao/data"
          }
        }
        volume {
          name = "config"
          config_map {
            name = kubernetes_config_map_v1.openbao_config.metadata[0].name
          }
        }
        volume {
          name = "data"
          persistent_volume_claim {
            claim_name = kubernetes_persistent_volume_claim_v1.openbao_data.metadata[0].name
          }
        }
      }
    }
  }

  depends_on = [
    kubernetes_cluster_role_binding.openbao_tokenreview,
    kubernetes_config_map_v1.openbao_config,
    kubernetes_persistent_volume_claim_v1.openbao_data,
  ]
}

resource "kubernetes_service" "openbao" {
  metadata {
    name      = "openbao"
    namespace = kubernetes_namespace.vault.metadata[0].name
    labels    = local.common_labels
  }
  spec {
    selector = { "app" = "openbao" }
    port {
      port        = 8200
      target_port = 8200
    }
  }
}

# Internal URL ESO will use to reach OpenBao
locals {
  openbao_url = "http://openbao.${local.vault_ns}.svc.cluster.local:8200"
}

# ---------------------------------------------------------------------------
# Seed secrets into OpenBao once the pod is ready.
# Runs after Supabase Helm release so JWT tokens are available.
# ---------------------------------------------------------------------------

resource "null_resource" "openbao_seed" {
  triggers = {
    supabase_db_hash  = sha256(random_password.supabase_db.result)
    jwt_secret_hash   = sha256(local.jwt_secret)
  }

  # All OpenBao API calls run inside the pod via kubectl exec so that cluster-internal
  # IPs are reachable (local-exec cannot reach kubernetes ClusterIP addresses).
  # Multiline values (CA cert, policies, JWT keys) are written to temp files inside
  # the pod to avoid shell quoting issues.
  provisioner "local-exec" {
    command = <<-EOF
      set -euo pipefail

      VAULT_NS="${local.vault_ns}"
      APP_NS="${local.app_ns}"
      BOOTSTRAP_SECRET="openbao-bootstrap"

      # Wait for pod to be ready (up to 5 min).
      kubectl rollout status deployment/openbao -n "$VAULT_NS" --timeout=300s

      POD=$(kubectl get pod -n "$VAULT_NS" -l app=openbao -o jsonpath='{.items[0].metadata.name}')

      # bao status exits 2 when not initialized; capture output regardless.
      BAO_STATUS=$(kubectl exec -n "$VAULT_NS" "$POD" -- sh -c 'VAULT_ADDR=http://127.0.0.1:8200 bao status -format=json' 2>/dev/null || true)
      INITIALIZED=$(echo "$BAO_STATUS" | python3 -c "import json,sys; print(json.load(sys.stdin)['initialized'])" 2>/dev/null || echo False)

      if [ "$INITIALIZED" = "False" ]; then
        INIT_JSON=$(kubectl exec -n "$VAULT_NS" "$POD" -- sh -c 'VAULT_ADDR=http://127.0.0.1:8200 bao operator init -key-shares=1 -key-threshold=1 -format=json')
        ROOT_TOKEN=$(echo "$INIT_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['root_token'])")
        UNSEAL_KEY=$(echo "$INIT_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['unseal_keys_b64'][0])")
        kubectl create secret generic "$BOOTSTRAP_SECRET" \
          -n "$VAULT_NS" \
          --from-literal=root_token="$ROOT_TOKEN" \
          --from-literal=unseal_key="$UNSEAL_KEY" \
          --dry-run=client -o yaml | kubectl apply -f -
      fi

      ROOT_TOKEN=$(kubectl get secret "$BOOTSTRAP_SECRET" -n "$VAULT_NS" -o jsonpath='{.data.root_token}' | base64 -d)
      UNSEAL_KEY=$(kubectl get secret "$BOOTSTRAP_SECRET" -n "$VAULT_NS" -o jsonpath='{.data.unseal_key}' | base64 -d)

      # Re-check sealed state and unseal if needed.
      BAO_STATUS=$(kubectl exec -n "$VAULT_NS" "$POD" -- sh -c 'VAULT_ADDR=http://127.0.0.1:8200 bao status -format=json' 2>/dev/null || true)
      SEALED=$(echo "$BAO_STATUS" | python3 -c "import json,sys; print(json.load(sys.stdin)['sealed'])" 2>/dev/null || echo True)
      if [ "$SEALED" = "True" ]; then
        kubectl exec -n "$VAULT_NS" "$POD" -- sh -c "VAULT_ADDR=http://127.0.0.1:8200 bao operator unseal $UNSEAL_KEY" >/dev/null
      fi

      # Stage multiline data as temp files inside the pod to avoid quoting issues.
      kubectl get configmap kube-root-ca.crt -n "$VAULT_NS" -o jsonpath='{.data.ca\.crt}' | \
        kubectl exec -i -n "$VAULT_NS" "$POD" -- sh -c 'cat > /tmp/k8s-ca.pem'
      tr -d '\n' < ${path.module}/.supabase_anon_key | \
        kubectl exec -i -n "$VAULT_NS" "$POD" -- sh -c 'cat > /tmp/anon_key.txt'
      tr -d '\n' < ${path.module}/.supabase_service_key | \
        kubectl exec -i -n "$VAULT_NS" "$POD" -- sh -c 'cat > /tmp/service_key.txt'

      # Enable backends (idempotent).
      kubectl exec -n "$VAULT_NS" "$POD" -- sh -c "VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=$ROOT_TOKEN bao secrets enable -path=secret kv-v2" 2>/dev/null || true
      kubectl exec -n "$VAULT_NS" "$POD" -- sh -c "VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=$ROOT_TOKEN bao auth enable kubernetes" 2>/dev/null || true
      # Do NOT pass token_reviewer_jwt — OpenBao uses its own pod SA token (auto-refreshed by K8s).
      # Passing a short-lived kubectl-created token causes 403s after TTL expiry.
      kubectl exec -n "$VAULT_NS" "$POD" -- sh -c "VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=$ROOT_TOKEN bao write auth/kubernetes/config kubernetes_host=https://kubernetes.default.svc.cluster.local kubernetes_ca_cert=@/tmp/k8s-ca.pem"

      kubectl exec -n "$VAULT_NS" "$POD" -- sh -c "VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=$ROOT_TOKEN bao kv put secret/$APP_NS/frontend supabase_anon_key=@/tmp/anon_key.txt"
      kubectl exec -n "$VAULT_NS" "$POD" -- sh -c "VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=$ROOT_TOKEN bao kv put secret/$APP_NS/service-role supabase_service_role_key=@/tmp/service_key.txt"

      # Policies — write via stdin using -i.
      printf 'path "secret/data/%s/frontend" { capabilities = ["read"] }' "$APP_NS" | \
        kubectl exec -i -n "$VAULT_NS" "$POD" -- sh -c "VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=$ROOT_TOKEN bao policy write $APP_NS-frontend-read /dev/stdin"
      printf 'path "secret/data/%s/service-role" { capabilities = ["read"] }' "$APP_NS" | \
        kubectl exec -i -n "$VAULT_NS" "$POD" -- sh -c "VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=$ROOT_TOKEN bao policy write $APP_NS-temporal-worker-read /dev/stdin"
      printf 'path "secret/data/%s/service-role" { capabilities = ["read"] }' "$APP_NS" | \
        kubectl exec -i -n "$VAULT_NS" "$POD" -- sh -c "VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=$ROOT_TOKEN bao policy write $APP_NS-ops-api-read /dev/stdin"

      # Kubernetes auth roles.
      kubectl exec -n "$VAULT_NS" "$POD" -- sh -c "VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=$ROOT_TOKEN bao write auth/kubernetes/role/$APP_NS-frontend-read bound_service_account_names=${local.frontend_service_account_name} bound_service_account_namespaces=$APP_NS policies=$APP_NS-frontend-read ttl=24h"
      kubectl exec -n "$VAULT_NS" "$POD" -- sh -c "VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=$ROOT_TOKEN bao write auth/kubernetes/role/$APP_NS-temporal-worker-read bound_service_account_names=${local.temporal_worker_service_account_name} bound_service_account_namespaces=$APP_NS policies=$APP_NS-temporal-worker-read ttl=24h"
      kubectl exec -n "$VAULT_NS" "$POD" -- sh -c "VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=$ROOT_TOKEN bao write auth/kubernetes/role/$APP_NS-ops-api-read bound_service_account_names=${local.ops_api_service_account_name} bound_service_account_namespaces=$APP_NS policies=$APP_NS-ops-api-read ttl=24h"

      echo "OpenBao seeded successfully for $APP_NS"
    EOF
  }

  depends_on = [
    kubernetes_deployment.openbao,
    kubernetes_service.openbao,
    null_resource.generate_supabase_jwts,
    helm_release.supabase,
  ]
}
