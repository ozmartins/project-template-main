resource "kubernetes_namespace" "app" {
  metadata {
    name   = local.app_ns
    labels = local.common_labels
  }
}

resource "kubernetes_namespace" "supabase" {
  metadata {
    name = local.supabase_ns
    labels = merge(local.common_labels, {
      "app.kubernetes.io/component" = "supabase"
    })
  }
}

resource "kubernetes_namespace" "vault" {
  metadata {
    name = local.vault_ns
    labels = merge(local.common_labels, {
      "app.kubernetes.io/component" = "vault"
    })
  }
}

# ---------------------------------------------------------------------------
# RBAC: gha-deployer — namespace-scoped, no ClusterRole
# ---------------------------------------------------------------------------

resource "kubernetes_service_account" "gha_deployer" {
  metadata {
    name      = "gha-deployer"
    namespace = kubernetes_namespace.app.metadata[0].name
    labels    = local.common_labels
  }
}

resource "kubernetes_role" "gha_deployer" {
  metadata {
    name      = "gha-deployer"
    namespace = kubernetes_namespace.app.metadata[0].name
    labels    = local.common_labels
  }

  rule {
    api_groups = ["apps"]
    resources  = ["deployments", "replicasets"]
    verbs      = ["get", "list", "watch", "create", "patch", "update", "delete"]
  }
  rule {
    api_groups = [""]
    resources  = ["services", "configmaps", "pods", "pods/log", "events", "serviceaccounts"]
    verbs      = ["get", "list", "watch", "create", "patch", "update", "delete"]
  }
  rule {
    api_groups = ["networking.k8s.io"]
    resources  = ["ingresses"]
    verbs      = ["get", "list", "watch", "create", "patch", "update", "delete"]
  }
  rule {
    api_groups = [""]
    resources  = ["secrets"]
    verbs      = ["get", "list", "watch", "create", "patch", "update", "delete"]
  }
  rule {
    api_groups = ["external-secrets.io"]
    resources  = ["externalsecrets"]
    verbs      = ["get", "list", "watch", "create", "patch", "update", "delete"]
  }
  rule {
    api_groups = ["policy"]
    resources  = ["poddisruptionbudgets"]
    verbs      = ["get", "list", "watch", "create", "patch", "update", "delete"]
  }
  rule {
    api_groups = ["autoscaling"]
    resources  = ["horizontalpodautoscalers"]
    verbs      = ["get", "list", "watch", "create", "patch", "update", "delete"]
  }
}

resource "kubernetes_role_binding" "gha_deployer" {
  metadata {
    name      = "gha-deployer"
    namespace = kubernetes_namespace.app.metadata[0].name
    labels    = local.common_labels
  }
  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "Role"
    name      = kubernetes_role.gha_deployer.metadata[0].name
  }
  subject {
    kind      = "ServiceAccount"
    name      = kubernetes_service_account.gha_deployer.metadata[0].name
    namespace = kubernetes_namespace.app.metadata[0].name
  }
}

# Long-lived token for GHA kubeconfig
resource "kubernetes_secret" "gha_deployer_token" {
  metadata {
    name      = "gha-deployer-token"
    namespace = kubernetes_namespace.app.metadata[0].name
    annotations = {
      "kubernetes.io/service-account.name" = kubernetes_service_account.gha_deployer.metadata[0].name
    }
  }
  type = "kubernetes.io/service-account-token"
}

# ---------------------------------------------------------------------------
# RBAC: db-bootstrap — Supabase namespace, least-privilege for migration jobs
# ---------------------------------------------------------------------------

# db-bootstrap: in-cluster job SA (minimal — exec only, NO create/configmap/job).
resource "kubernetes_service_account" "db_bootstrap" {
  metadata {
    name      = "db-bootstrap"
    namespace = kubernetes_namespace.supabase.metadata[0].name
    labels    = local.common_labels
  }
}

resource "kubernetes_role" "db_bootstrap" {
  metadata {
    name      = "db-bootstrap"
    namespace = kubernetes_namespace.supabase.metadata[0].name
    labels    = local.common_labels
  }

  # The in-cluster bootstrap job needs to exec into the DB pod to run migrations.
  # require_cannot_i checks: must NOT create jobs.batch/configmaps or delete pods.
  rule {
    api_groups = [""]
    resources  = ["pods", "pods/exec", "pods/log"]
    verbs      = ["get", "list", "watch", "create"]
  }
  rule {
    api_groups = [""]
    resources  = ["configmaps"]
    verbs      = ["get", "list", "watch"]
  }
  rule {
    api_groups = [""]
    resources  = ["secrets"]
    verbs      = ["get", "list"]
  }
}

resource "kubernetes_role_binding" "db_bootstrap" {
  metadata {
    name      = "db-bootstrap"
    namespace = kubernetes_namespace.supabase.metadata[0].name
    labels    = local.common_labels
  }
  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "Role"
    name      = kubernetes_role.db_bootstrap.metadata[0].name
  }
  subject {
    kind      = "ServiceAccount"
    name      = kubernetes_service_account.db_bootstrap.metadata[0].name
    namespace = kubernetes_namespace.supabase.metadata[0].name
  }
}

# db-bootstrap-runner: GHA runner SA — broader permissions to set up the job.
resource "kubernetes_service_account" "db_bootstrap_runner" {
  metadata {
    name      = "db-bootstrap-runner"
    namespace = kubernetes_namespace.supabase.metadata[0].name
    labels    = local.common_labels
  }
}

resource "kubernetes_role" "db_bootstrap_runner" {
  metadata {
    name      = "db-bootstrap-runner"
    namespace = kubernetes_namespace.supabase.metadata[0].name
    labels    = local.common_labels
  }

  rule {
    api_groups = [""]
    resources  = ["serviceaccounts"]
    verbs      = ["get"]
  }
  rule {
    api_groups = [""]
    resources  = ["configmaps"]
    verbs      = ["get", "list", "create", "delete"]
  }
  rule {
    api_groups = ["batch"]
    resources  = ["jobs"]
    verbs      = ["get", "list", "watch", "create", "delete"]
  }
  rule {
    api_groups = [""]
    resources  = ["pods", "pods/log"]
    verbs      = ["get", "list", "watch"]
  }
}

resource "kubernetes_role_binding" "db_bootstrap_runner" {
  metadata {
    name      = "db-bootstrap-runner"
    namespace = kubernetes_namespace.supabase.metadata[0].name
    labels    = local.common_labels
  }
  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "Role"
    name      = kubernetes_role.db_bootstrap_runner.metadata[0].name
  }
  subject {
    kind      = "ServiceAccount"
    name      = kubernetes_service_account.db_bootstrap_runner.metadata[0].name
    namespace = kubernetes_namespace.supabase.metadata[0].name
  }
}

resource "kubernetes_secret" "db_bootstrap_token" {
  metadata {
    name      = "db-bootstrap-token"
    namespace = kubernetes_namespace.supabase.metadata[0].name
    annotations = {
      "kubernetes.io/service-account.name" = kubernetes_service_account.db_bootstrap_runner.metadata[0].name
    }
  }
  type = "kubernetes.io/service-account-token"
}

resource "kubernetes_service_account" "frontend" {
  metadata {
    name      = local.frontend_service_account_name
    namespace = kubernetes_namespace.app.metadata[0].name
    labels = merge(local.common_labels, {
      "app.kubernetes.io/component"  = "frontend"
      "app.kubernetes.io/managed-by" = "Helm"
    })
    annotations = {
      "meta.helm.sh/release-name"      = local.app_release_name
      "meta.helm.sh/release-namespace" = local.app_ns
    }
  }
}

resource "kubernetes_service_account" "temporal_worker" {
  metadata {
    name      = local.temporal_worker_service_account_name
    namespace = kubernetes_namespace.app.metadata[0].name
    labels = merge(local.common_labels, {
      "app.kubernetes.io/component"  = "temporal-worker"
      "app.kubernetes.io/managed-by" = "Helm"
    })
    annotations = {
      "meta.helm.sh/release-name"      = local.app_release_name
      "meta.helm.sh/release-namespace" = local.app_ns
    }
  }
}

resource "kubernetes_service_account" "ops_api" {
  metadata {
    name      = local.ops_api_service_account_name
    namespace = kubernetes_namespace.app.metadata[0].name
    labels = merge(local.common_labels, {
      "app.kubernetes.io/component"  = "ops-api"
      "app.kubernetes.io/managed-by" = "Helm"
    })
    annotations = {
      "meta.helm.sh/release-name"      = local.app_release_name
      "meta.helm.sh/release-namespace" = local.app_ns
    }
  }
}
