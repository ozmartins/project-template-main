# ---------------------------------------------------------------------------
# ESO SecretStores — each workload gets its own OpenBao-backed identity.
# Secret keys match the env var names consumed by the Helm chart.
# ---------------------------------------------------------------------------

resource "kubernetes_manifest" "eso_secret_store_frontend" {
  manifest = {
    apiVersion = "external-secrets.io/${var.eso_api_version}"
    kind       = "SecretStore"
    metadata = {
      name      = "openbao-frontend-${local.app_ns}"
      namespace = local.app_ns
      labels    = local.common_labels
    }
    spec = {
      provider = {
        vault = {
          server  = local.openbao_url
          path    = "secret"
          version = "v2"
          auth = {
            kubernetes = {
              mountPath = "kubernetes"
              role      = "${local.app_ns}-frontend-read"
              serviceAccountRef = {
                name = local.frontend_service_account_name
              }
            }
          }
        }
      }
    }
  }

  depends_on = [null_resource.openbao_seed]
}

resource "kubernetes_manifest" "eso_secret_store_temporal_worker" {
  manifest = {
    apiVersion = "external-secrets.io/${var.eso_api_version}"
    kind       = "SecretStore"
    metadata = {
      name      = "openbao-temporal-worker-${local.app_ns}"
      namespace = local.app_ns
      labels    = local.common_labels
    }
    spec = {
      provider = {
        vault = {
          server  = local.openbao_url
          path    = "secret"
          version = "v2"
          auth = {
            kubernetes = {
              mountPath = "kubernetes"
              role      = "${local.app_ns}-temporal-worker-read"
              serviceAccountRef = {
                name = local.temporal_worker_service_account_name
              }
            }
          }
        }
      }
    }
  }

  depends_on = [null_resource.openbao_seed]
}

resource "kubernetes_manifest" "eso_secret_store_ops_api" {
  manifest = {
    apiVersion = "external-secrets.io/${var.eso_api_version}"
    kind       = "SecretStore"
    metadata = {
      name      = "openbao-ops-api-${local.app_ns}"
      namespace = local.app_ns
      labels    = local.common_labels
    }
    spec = {
      provider = {
        vault = {
          server  = local.openbao_url
          path    = "secret"
          version = "v2"
          auth = {
            kubernetes = {
              mountPath = "kubernetes"
              role      = "${local.app_ns}-ops-api-read"
              serviceAccountRef = {
                name = local.ops_api_service_account_name
              }
            }
          }
        }
      }
    }
  }

  depends_on = [null_resource.openbao_seed]
}

# ---------------------------------------------------------------------------
# ExternalSecret: frontend anon key
# ---------------------------------------------------------------------------

resource "kubernetes_manifest" "eso_frontend" {
  field_manager {
    force_conflicts = true
  }

  manifest = {
    apiVersion = "external-secrets.io/${var.eso_api_version}"
    kind       = "ExternalSecret"
    metadata = {
      name      = "frontend-secrets"
      namespace = local.app_ns
      labels    = local.common_labels
    }
    spec = {
      refreshInterval = "5m"
      secretStoreRef = {
        name = "openbao-frontend-${local.app_ns}"
        kind = "SecretStore"
      }
      target = {
        name           = local.frontend_secret_name
        creationPolicy = "Owner"
      }
      data = [
        {
          secretKey = "VITE_SUPABASE_ANON_KEY"
          remoteRef = {
            key      = "${local.app_ns}/frontend"
            property = "supabase_anon_key"
          }
        }
      ]
    }
  }

  depends_on = [kubernetes_manifest.eso_secret_store_frontend]
}

# ---------------------------------------------------------------------------
# ExternalSecret: temporal-worker service-role key
# ---------------------------------------------------------------------------

resource "kubernetes_manifest" "eso_temporal_worker" {
  field_manager {
    force_conflicts = true
  }

  manifest = {
    apiVersion = "external-secrets.io/${var.eso_api_version}"
    kind       = "ExternalSecret"
    metadata = {
      name      = "temporal-worker-secrets"
      namespace = local.app_ns
      labels    = local.common_labels
    }
    spec = {
      refreshInterval = "5m"
      secretStoreRef = {
        name = "openbao-temporal-worker-${local.app_ns}"
        kind = "SecretStore"
      }
      target = {
        name           = local.temporal_worker_secret_name
        creationPolicy = "Owner"
      }
      data = [
        {
          secretKey = "SUPABASE_SERVICE_ROLE_KEY"
          remoteRef = {
            key      = "${local.app_ns}/service-role"
            property = "supabase_service_role_key"
          }
        }
      ]
    }
  }

  depends_on = [kubernetes_manifest.eso_secret_store_temporal_worker]
}

# ---------------------------------------------------------------------------
# ExternalSecret: ops-api service-role key
# ---------------------------------------------------------------------------

resource "kubernetes_manifest" "eso_ops_api" {
  manifest = {
    apiVersion = "external-secrets.io/${var.eso_api_version}"
    kind       = "ExternalSecret"
    metadata = {
      name      = "ops-api-secrets"
      namespace = local.app_ns
      labels    = local.common_labels
    }
    spec = {
      refreshInterval = "5m"
      secretStoreRef = {
        name = "openbao-ops-api-${local.app_ns}"
        kind = "SecretStore"
      }
      target = {
        name           = local.ops_api_secret_name
        creationPolicy = "Owner"
      }
      data = [
        {
          secretKey = "SUPABASE_SERVICE_ROLE_KEY"
          remoteRef = {
            key      = "${local.app_ns}/service-role"
            property = "supabase_service_role_key"
          }
        }
      ]
    }
  }

  depends_on = [kubernetes_manifest.eso_secret_store_ops_api]
}
