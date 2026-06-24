terraform {
  required_version = ">= 1.6"
  required_providers {
    azurerm    = { source = "hashicorp/azurerm", version = "~> 3.100" }
    kubernetes = { source = "hashicorp/kubernetes", version = "~> 2.27" }
    helm       = { source = "hashicorp/helm", version = "~> 2.13" }
    random     = { source = "hashicorp/random", version = "~> 3.6" }
    github     = { source = "integrations/github", version = "~> 6.2" }
    null       = { source = "hashicorp/null", version = "~> 3.2" }
    local      = { source = "hashicorp/local", version = "~> 2.5" }
    aws        = { source = "hashicorp/aws", version = "~> 5.50" }
  }
}

provider "azurerm" {
  features {}
  subscription_id = "44542832-156a-4b4e-a4fd-5a182428ca1e"
}

provider "kubernetes" {
  host        = var.aks_host
  token       = var.aks_token != "" ? var.aks_token : null
  insecure    = var.aks_token != "" ? true : false
  config_path = var.aks_token != "" ? "" : null

  cluster_ca_certificate = var.aks_token == "" ? base64decode(var.aks_ca_cert) : null

  dynamic "exec" {
    for_each = var.aks_token == "" ? [1] : []
    content {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "kubelogin"
      args        = ["get-token", "--login", "spn", "--environment", "AzurePublicCloud", "--tenant-id", var.tenant_id, "--server-id", "6dae42f8-4368-4678-94ff-3960e28e3630"]
      env = {
        AAD_SERVICE_PRINCIPAL_CLIENT_ID     = var.client_id
        AAD_SERVICE_PRINCIPAL_CLIENT_SECRET = var.client_secret
      }
    }
  }
}

provider "helm" {
  kubernetes {
    host        = var.aks_host
    token       = var.aks_token != "" ? var.aks_token : null
    insecure    = var.aks_token != "" ? true : false
    config_path = var.aks_token != "" ? "" : null

    cluster_ca_certificate = var.aks_token == "" ? base64decode(var.aks_ca_cert) : null

    dynamic "exec" {
      for_each = var.aks_token == "" ? [1] : []
      content {
        api_version = "client.authentication.k8s.io/v1beta1"
        command     = "kubelogin"
        args        = ["get-token", "--login", "spn", "--environment", "AzurePublicCloud", "--tenant-id", var.tenant_id, "--server-id", "6dae42f8-4368-4678-94ff-3960e28e3630"]
        env = {
          AAD_SERVICE_PRINCIPAL_CLIENT_ID     = var.client_id
          AAD_SERVICE_PRINCIPAL_CLIENT_SECRET = var.client_secret
        }
      }
    }
  }
}

provider "github" {
  owner = "Volaris-AI"
  token = var.github_token
}

provider "aws" {
  region = "us-east-1"
}

module "app" {
  source = "../../modules/app-instance"

  app_name    = "10x-stack"
  environment = "dev"
  cloud       = "azure"

  # Container registry
  acr_login_server = "acrselfhealstg.azurecr.io"
  acr_username     = var.acr_username
  acr_password     = var.acr_password

  # Temporal (shared in 'dev' namespace)
  temporal_address = "temporal-frontend.dev.svc.cluster.local:7233"

  # Azure Front Door — attach to shared profile
  afd_profile_name   = "10x-stack-afd"
  afd_resource_group = "rg-selfheal-staging"

  # Supabase
  supabase_chart_version = "0.5.6"
  supabase_storage_class = "managed-premium"
  supabase_db_size       = "5Gi"

  # OpenBao
  openbao_image = "openbao/openbao:2.5.4"

  # ESO on AKS uses v1 (ESO >=0.9), not v1beta1
  eso_api_version = "v1"

  # GitHub
  github_repo = "Volaris-AI/project-template"

  # GHA kubeconfig
  k8s_api_server = var.aks_host
  k8s_ca_data    = var.aks_ca_cert
}

output "public_url" {
  value = module.app.public_url
}

output "app_namespace" {
  value = module.app.app_namespace
}
