# ---------------------------------------------------------------------------
# App Helm release — the charts/app/ chart that ships with this template
# ---------------------------------------------------------------------------

resource "helm_release" "app" {
  name      = local.app_release_name
  chart     = "${path.module}/../../../charts/app"
  namespace = kubernetes_namespace.app.metadata[0].name
  timeout      = 300
  wait         = false
  # Preserve the image references set by the pipeline (imageRegistry, image.repository, etc.).
  # Terraform only applies its set {} overrides on top of whatever is currently deployed.
  reuse_values = true

  values = compact([
    file("${path.module}/../../../charts/app/values-dev.yaml"),
    var.cloud == "aws" ? file("${path.module}/../../../charts/app/values-aws-dev.yaml") : "",
    var.cloud == "azure" ? file("${path.module}/../../../charts/app/values-azure-dev.yaml") : "",
  ])

  # Override the per-app dynamic values that Terraform generates

  # Disable chart-managed ExternalSecrets — Terraform creates per-workload SecretStores.
  set {
    name  = "externalSecrets.enabled"
    value = "false"
  }

  set {
    name  = "imageRegistry"
    value = var.acr_login_server
  }
  set {
    name  = "global.supabaseUrl"
    value = local.supabase_internal_url
  }
  set {
    name  = "temporalWorker.temporal.namespace"
    value = local.temporal_namespace
  }
  set {
    name  = "temporalWorker.temporal.taskQueue"
    value = local.temporal_task_queue
  }
  set {
    name  = "opsApi.temporal.namespace"
    value = local.temporal_namespace
  }
  set {
    name  = "temporalWorker.supabase.url"
    value = local.supabase_internal_url
  }
  set {
    name  = "opsApi.supabase.url"
    value = local.supabase_internal_url
  }
  set {
    name  = "frontend.serviceAccount.name"
    value = local.frontend_service_account_name
  }
  set {
    name  = "temporalWorker.serviceAccount.name"
    value = local.temporal_worker_service_account_name
  }
  set {
    name  = "opsApi.serviceAccount.name"
    value = local.ops_api_service_account_name
  }
  set {
    name  = "frontend.secrets.supabaseAnonKey.secretName"
    value = local.frontend_secret_name
  }
  set {
    name  = "temporalWorker.secrets.supabaseServiceRoleKey.secretName"
    value = local.temporal_worker_secret_name
  }
  set {
    name  = "opsApi.secrets.supabaseServiceRoleKey.secretName"
    value = local.ops_api_secret_name
  }

  depends_on = [
    kubernetes_namespace.app,
    kubernetes_secret.acr_pull,
    kubernetes_service_account.frontend,
    kubernetes_service_account.temporal_worker,
    kubernetes_service_account.ops_api,
    kubernetes_manifest.eso_frontend,
    kubernetes_manifest.eso_temporal_worker,
    kubernetes_manifest.eso_ops_api,
    null_resource.temporal_namespace,
    helm_release.supabase,
  ]
}
