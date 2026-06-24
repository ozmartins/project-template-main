# ---------------------------------------------------------------------------
# Push per-app GitHub Actions secrets so CI/CD can deploy without manual steps.
# Requires GITHUB_TOKEN env var with repo-secrets write permission.
# ---------------------------------------------------------------------------

locals {
  # Build a kubeconfig entry that GHA uses to deploy to this namespace only.
  gha_kubeconfig = yamlencode({
    apiVersion = "v1"
    kind       = "Config"
    clusters = [{
      name = "${var.app_name}-${var.environment}"
      cluster = {
        server                     = var.k8s_api_server
        certificate-authority-data = var.k8s_ca_data
      }
    }]
    users = [{
      name = "gha-deployer"
      user = {
        token = kubernetes_secret.gha_deployer_token.data["token"]
      }
    }]
    contexts = [{
      name = "${var.app_name}-${var.environment}"
      context = {
        cluster   = "${var.app_name}-${var.environment}"
        user      = "gha-deployer"
        namespace = local.app_ns
      }
    }]
    current-context = "${var.app_name}-${var.environment}"
  })
}

resource "github_actions_secret" "kubeconfig" {
  repository      = split("/", var.github_repo)[1]
  secret_name     = "KUBECONFIG_${upper(replace("${var.app_name}_${var.environment}", "-", "_"))}"
  plaintext_value = local.gha_kubeconfig
}

resource "github_actions_secret" "deploy_namespace" {
  repository      = split("/", var.github_repo)[1]
  secret_name     = "K8S_NAMESPACE_${upper(replace("${var.app_name}_${var.environment}", "-", "_"))}"
  plaintext_value = local.app_ns
}

# ACR secrets are Azure-only; on AWS the node IAM role handles ECR auth.
# Least-privilege kubeconfig for in-cluster DB bootstrap jobs (Supabase namespace only).
locals {
  gha_db_bootstrap_kubeconfig = yamlencode({
    apiVersion = "v1"
    kind       = "Config"
    clusters = [{
      name = "${var.app_name}-${var.environment}-db-bootstrap"
      cluster = {
        server                     = var.k8s_api_server
        certificate-authority-data = var.k8s_ca_data
      }
    }]
    users = [{
      name = "db-bootstrap"
      user = {
        token = kubernetes_secret.db_bootstrap_token.data["token"]
      }
    }]
    contexts = [{
      name = "${var.app_name}-${var.environment}-db-bootstrap"
      context = {
        cluster   = "${var.app_name}-${var.environment}-db-bootstrap"
        user      = "db-bootstrap"
        namespace = local.supabase_ns
      }
    }]
    current-context = "${var.app_name}-${var.environment}-db-bootstrap"
  })
}

resource "github_actions_secret" "db_bootstrap_kubeconfig" {
  repository      = split("/", var.github_repo)[1]
  secret_name     = "KUBE_CONFIG_DEV_DB_BOOTSTRAP"
  plaintext_value = local.gha_db_bootstrap_kubeconfig
}

resource "github_actions_secret" "acr_server" {
  count           = var.cloud == "azure" ? 1 : 0
  repository      = split("/", var.github_repo)[1]
  secret_name     = "ACR_LOGIN_SERVER"
  plaintext_value = var.acr_login_server
}

resource "github_actions_secret" "acr_username" {
  count           = var.cloud == "azure" ? 1 : 0
  repository      = split("/", var.github_repo)[1]
  secret_name     = "ACR_USERNAME"
  plaintext_value = var.acr_username
}

resource "github_actions_secret" "acr_password" {
  count           = var.cloud == "azure" ? 1 : 0
  repository      = split("/", var.github_repo)[1]
  secret_name     = "ACR_PASSWORD"
  plaintext_value = var.acr_password
}
