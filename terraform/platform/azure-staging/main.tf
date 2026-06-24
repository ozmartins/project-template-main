# ---------------------------------------------------------------------------
# Platform baseline: Azure staging
# This file ASSERTS that shared infrastructure already exists.
# It creates nothing. Run it to verify prereqs before applying app stacks.
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.6"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.100"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.27"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

# --- Assert shared resources exist ---

data "azurerm_resource_group" "platform" {
  name = var.resource_group
}

data "azurerm_kubernetes_cluster" "aks" {
  name                = var.aks_cluster_name
  resource_group_name = var.resource_group
}

data "azurerm_container_registry" "acr" {
  name                = var.acr_name
  resource_group_name = var.resource_group
}

# ESO and Temporal are deployed to the cluster — assert their namespaces exist.
data "kubernetes_namespace" "external_secrets" {
  metadata { name = "external-secrets" }
}

data "kubernetes_namespace" "temporal" {
  metadata { name = "dev" }
}

# --- Outputs consumed by app stacks ---

output "aks_host" {
  value = data.azurerm_kubernetes_cluster.aks.kube_config[0].host
}

output "aks_ca_cert" {
  value     = data.azurerm_kubernetes_cluster.aks.kube_config[0].cluster_ca_certificate
  sensitive = true
}

output "acr_login_server" {
  value = data.azurerm_container_registry.acr.login_server
}

output "resource_group" {
  value = data.azurerm_resource_group.platform.name
}
