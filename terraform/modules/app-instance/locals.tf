locals {
  # Canonical namespace names derived from app_name + environment
  app_ns       = "${var.app_name}-${var.environment}"       # e.g. 10x-stack-dev
  supabase_ns  = "${var.app_name}-supabase"                 # e.g. 10x-stack-supabase
  vault_ns     = "${var.app_name}-vault"                    # e.g. 10x-stack-vault

  app_release_name = "rental-app"

  frontend_service_account_name        = "${local.app_release_name}-frontend"
  temporal_worker_service_account_name = "${local.app_release_name}-temporal-worker"
  ops_api_service_account_name         = "${local.app_release_name}-ops-api"

  frontend_secret_name        = "frontend-secrets-${local.app_ns}"
  temporal_worker_secret_name = "temporal-worker-secrets-${local.app_ns}"
  ops_api_secret_name         = "ops-api-secrets-${local.app_ns}"

  # Supabase internal cluster address (used by worker + ops-api)
  supabase_internal_url = "http://supabase-supabase-kong.${local.supabase_ns}.svc.cluster.local"

  # Temporal namespace and task queue for this app instance
  temporal_namespace = local.app_ns
  temporal_task_queue = "${local.app_ns}-main"

  # Common labels applied to all resources
  common_labels = {
    "app.kubernetes.io/part-of"  = var.app_name
    "app.factory/environment"    = var.environment
    "app.factory/managed-by"     = "terraform"
  }

  # Azure resource tags — no "/" allowed in tag names (AFD, ARM restriction)
  azure_tags = {
    "app-part-of"   = var.app_name
    "environment"   = var.environment
    "managed-by"    = "terraform"
  }
}
