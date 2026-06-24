# ---------------------------------------------------------------------------
# 10x-stack AWS dev — full app instance backed by EKS + ECR
# Platform prereqs (Temporal, ESO, EBS CSI, node group) are provisioned by
# terraform/platform/aws-staging which must be applied first.
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws        = { source = "hashicorp/aws", version = "~> 5.50" }
    azurerm    = { source = "hashicorp/azurerm", version = "~> 3.100" }
    kubernetes = { source = "hashicorp/kubernetes", version = "~> 2.27" }
    helm       = { source = "hashicorp/helm", version = "~> 2.13" }
    random     = { source = "hashicorp/random", version = "~> 3.6" }
    github     = { source = "integrations/github", version = "~> 6.2" }
    null       = { source = "hashicorp/null", version = "~> 3.2" }
    local      = { source = "hashicorp/local", version = "~> 2.5" }
  }

  backend "s3" {
    bucket = "10x-stack-tfstate-354918379520"
    key    = "stacks/10x-stack-aws-dev.tfstate"
    region = "us-east-1"
  }
}

# ---------------------------------------------------------------------------
# Providers — all wired from EKS cluster data sources
# ---------------------------------------------------------------------------
provider "aws" {
  region = var.aws_region
}

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

provider "github" {
  owner = "Volaris-AI"
  token = var.github_token
}

# azurerm required by the app-instance module (Azure Front Door resources are
# no-ops on AWS since create_afd = false), but the provider must be declared.
provider "azurerm" {
  features {}
  skip_provider_registration = true
}

# ---------------------------------------------------------------------------
# ECR registry — no credentials needed; nodes pull via IAM role
# ---------------------------------------------------------------------------
data "aws_caller_identity" "current" {}

locals {
  ecr_registry = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com"
}

# ---------------------------------------------------------------------------
# App instance module
# ---------------------------------------------------------------------------
module "app" {
  source = "../../modules/app-instance"

  app_name    = "10x-stack"
  environment = "dev"
  cloud       = "aws"

  # ECR — auth via node IAM role (AmazonEC2ContainerRegistryReadOnly).
  # Pass the registry as acr_login_server so the Helm imageRegistry override
  # works; username/password are empty since no pull secret is needed.
  acr_login_server = local.ecr_registry
  acr_username     = ""
  acr_password     = ""

  # Temporal shared in 'dev' namespace (installed by platform/aws-staging)
  temporal_address = "temporal-frontend.dev.svc.cluster.local:7233"

  # AFD fields empty on AWS (CloudFront created by the module instead)
  afd_profile_name   = ""
  afd_resource_group = ""

  # Supabase — gp2 is the storage class on this EKS cluster
  supabase_chart_version = "0.5.6"
  supabase_storage_class = "gp2"
  supabase_db_size       = "5Gi"

  # OpenBao
  openbao_image         = "openbao/openbao:2.5.4"
  openbao_storage_class = "gp2"

  # GitHub — push kubeconfig secret for CI deploy
  github_repo    = "Volaris-AI/project-template"
  k8s_api_server = data.aws_eks_cluster.platform.endpoint
  k8s_ca_data    = data.aws_eks_cluster.platform.certificate_authority[0].data
}

# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------
output "public_url" {
  value = module.app.public_url
}

output "app_namespace" {
  value = module.app.app_namespace
}

output "cloudfront_domain" {
  value = module.app.cloudfront_domain
}
