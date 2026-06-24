terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.27"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.13"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  backend "s3" {
    bucket = "10x-stack-tfstate-354918379520"
    key    = "platform/aws-staging.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region
}

# Read the existing cluster — created outside Terraform; we manage addons/nodegroups
data "aws_eks_cluster" "platform" {
  name = var.eks_cluster_name
}

data "aws_eks_cluster_auth" "platform" {
  name = var.eks_cluster_name
}

provider "kubernetes" {
  host                   = data.aws_eks_cluster.platform.endpoint
  cluster_ca_certificate = base64decode(data.aws_eks_cluster.platform.certificate_authority[0].data)
  token                  = data.aws_eks_cluster_auth.platform.token
}

provider "helm" {
  kubernetes {
    host                   = data.aws_eks_cluster.platform.endpoint
    cluster_ca_certificate = base64decode(data.aws_eks_cluster.platform.certificate_authority[0].data)
    token                  = data.aws_eks_cluster_auth.platform.token
  }
}

# ---------------------------------------------------------------------------
# Enable public API endpoint so Terraform runner can reach the cluster
# ---------------------------------------------------------------------------
resource "null_resource" "enable_public_access" {
  triggers = {
    cluster = data.aws_eks_cluster.platform.name
  }

  provisioner "local-exec" {
    command = <<-EOF
      aws eks update-cluster-config \
        --region ${var.aws_region} \
        --name ${var.eks_cluster_name} \
        --resources-vpc-config endpointPublicAccess=true,endpointPrivateAccess=true \
        2>/dev/null || true

      # Wait for update to complete
      aws eks wait cluster-active \
        --region ${var.aws_region} \
        --name ${var.eks_cluster_name}
    EOF
  }
}

# ---------------------------------------------------------------------------
# Managed nodegroup — 2 x t3.medium in private subnets
# ---------------------------------------------------------------------------
data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [data.aws_eks_cluster.platform.vpc_config[0].vpc_id]
  }
  filter {
    name   = "tag:Name"
    values = ["*private*"]
  }
}

resource "aws_eks_node_group" "default" {
  cluster_name    = data.aws_eks_cluster.platform.name
  node_group_name = "default"
  node_role_arn   = var.node_role_arn
  subnet_ids      = data.aws_subnets.private.ids

  instance_types = ["t3.medium"]

  scaling_config {
    desired_size = 2
    max_size     = 4
    min_size     = 1
  }

  update_config {
    max_unavailable = 1
  }

  labels = {
    "role" = "workload"
  }

  tags = {
    "Environment" = "staging"
    "ManagedBy"   = "terraform"
  }

  lifecycle {
    ignore_changes = [scaling_config[0].desired_size]
  }

  depends_on = [null_resource.enable_public_access]
}

# ---------------------------------------------------------------------------
# EBS CSI Driver addon — required for gp2/gp3 PVC provisioning on EKS 1.21+
# Uses a service-linked IAM role so no IRSA setup needed.
# ---------------------------------------------------------------------------
resource "aws_eks_addon" "ebs_csi" {
  cluster_name             = data.aws_eks_cluster.platform.name
  addon_name               = "aws-ebs-csi-driver"
  addon_version            = "v1.62.0-eksbuild.1"
  service_account_role_arn = aws_iam_role.ebs_csi.arn
  resolve_conflicts_on_update = "OVERWRITE"

  depends_on = [aws_eks_node_group.default]
}

data "aws_iam_openid_connect_provider" "eks" {
  url = data.aws_eks_cluster.platform.identity[0].oidc[0].issuer
}

resource "aws_iam_role" "ebs_csi" {
  name = "${var.eks_cluster_name}-ebs-csi"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = data.aws_iam_openid_connect_provider.eks.arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${replace(data.aws_iam_openid_connect_provider.eks.url, "https://", "")}:aud" = "sts.amazonaws.com"
          "${replace(data.aws_iam_openid_connect_provider.eks.url, "https://", "")}:sub" = "system:serviceaccount:kube-system:ebs-csi-controller-sa"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ebs_csi" {
  role       = aws_iam_role.ebs_csi.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
}

# Allow nodes to join the cluster
resource "kubernetes_config_map_v1_data" "aws_auth" {
  metadata {
    name      = "aws-auth"
    namespace = "kube-system"
  }
  data = {
    mapRoles = yamlencode([
      {
        rolearn  = var.node_role_arn
        username = "system:node:{{EC2PrivateDNSName}}"
        groups   = ["system:bootstrappers", "system:nodes"]
      }
    ])
  }
  force = true

  depends_on = [aws_eks_node_group.default]
}

# ---------------------------------------------------------------------------
# Platform namespaces
# ---------------------------------------------------------------------------
resource "kubernetes_namespace" "dev" {
  metadata {
    name = "dev"
    labels = {
      "app.factory/managed-by" = "terraform"
    }
  }

  depends_on = [aws_eks_node_group.default]
}

resource "kubernetes_namespace" "external_secrets" {
  metadata {
    name = "external-secrets"
    labels = {
      "app.factory/managed-by" = "terraform"
    }
  }

  depends_on = [aws_eks_node_group.default]
}

# ---------------------------------------------------------------------------
# External Secrets Operator — shared cluster service
# ---------------------------------------------------------------------------
resource "helm_release" "external_secrets" {
  name       = "external-secrets"
  repository = "https://charts.external-secrets.io"
  chart      = "external-secrets"
  version    = "0.12.1"
  namespace  = kubernetes_namespace.external_secrets.metadata[0].name
  timeout    = 300

  set {
    name  = "installCRDs"
    value = "true"
  }

  depends_on = [kubernetes_namespace.external_secrets]
}

# ---------------------------------------------------------------------------
# Postgres — backing database for Temporal (shared in 'dev' namespace)
# Uses the local charts/postgres chart (same stack as AKS dev).
# ---------------------------------------------------------------------------
resource "random_password" "temporal_db" {
  length  = 24
  special = false
}

resource "kubernetes_secret" "temporal_postgres" {
  metadata {
    name      = "temporal-postgres-secret"
    namespace = kubernetes_namespace.dev.metadata[0].name
    labels = {
      "app.factory/managed-by" = "terraform"
    }
  }
  data = {
    password = random_password.temporal_db.result
  }

  depends_on = [kubernetes_namespace.dev]
}

resource "helm_release" "postgres" {
  name      = "postgres"
  chart     = "${path.module}/../../../charts/postgres"
  namespace = kubernetes_namespace.dev.metadata[0].name
  timeout   = 300

  set {
    name  = "password"
    value = random_password.temporal_db.result
  }
  set {
    name  = "database"
    value = "app"
  }
  set {
    name  = "persistence.storageClass"
    value = "gp2"
  }

  depends_on = [kubernetes_namespace.dev]
}

# ---------------------------------------------------------------------------
# Temporal — shared server in 'dev' namespace
# Uses the local charts/temporal wrapper chart (same images as AKS dev).
# The wrapper depends on the upstream temporalio/temporal subchart; the
# .tgz is committed to charts/temporal/charts/ so no network fetch needed.
# ---------------------------------------------------------------------------
resource "null_resource" "temporal_chart_deps" {
  triggers = {
    chart_yaml = filemd5("${path.module}/../../../charts/temporal/Chart.yaml")
  }

  provisioner "local-exec" {
    command     = "helm dependency build ."
    working_dir = "${path.module}/../../../charts/temporal"
  }
}

resource "helm_release" "temporal" {
  name      = "temporal"
  chart     = "${path.module}/../../../charts/temporal"
  namespace = kubernetes_namespace.dev.metadata[0].name
  timeout   = 600

  values = [
    file("${path.module}/../../../charts/temporal/values.yaml"),
    file("${path.module}/../../../charts/temporal/values-aws-dev.yaml"),
  ]

  depends_on = [
    kubernetes_namespace.dev,
    helm_release.postgres,
    kubernetes_secret.temporal_postgres,
    null_resource.temporal_chart_deps,
  ]
}

# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------
data "aws_caller_identity" "current" {}

output "eks_endpoint" {
  value = data.aws_eks_cluster.platform.endpoint
}

output "eks_ca_data" {
  value     = data.aws_eks_cluster.platform.certificate_authority[0].data
  sensitive = true
}

output "eks_cluster_name" {
  value = data.aws_eks_cluster.platform.name
}

output "ecr_registry" {
  value = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com"
}

output "temporal_address" {
  value = "temporal-frontend.dev.svc.cluster.local:7233"
}

output "eso_namespace" {
  value = kubernetes_namespace.external_secrets.metadata[0].name
}
