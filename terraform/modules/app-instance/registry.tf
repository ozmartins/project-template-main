# Image pull secret in the app namespace.
# Azure: ACR credentials → kubernetes.io/dockerconfigjson secret; every pod
#        references it via imagePullSecrets: [{name: acr-pull}].
# AWS:   ECR auth is handled by the node IAM role
#        (AmazonEC2ContainerRegistryReadOnly); an empty placeholder secret is
#        created so Helm chart references to imagePullSecrets remain valid.

locals {
  # On AWS, nodes authenticate to ECR via IAM — no real credentials needed.
  pull_secret_data = var.cloud == "aws" ? jsonencode({ auths = {} }) : jsonencode({
    auths = {
      (var.acr_login_server) = {
        username = var.acr_username
        password = var.acr_password
        auth     = base64encode("${var.acr_username}:${var.acr_password}")
      }
    }
  })
}

resource "kubernetes_secret" "acr_pull" {
  metadata {
    name      = "acr-pull"
    namespace = kubernetes_namespace.app.metadata[0].name
    labels    = local.common_labels
  }

  type = "kubernetes.io/dockerconfigjson"

  data = {
    ".dockerconfigjson" = local.pull_secret_data
  }
}
