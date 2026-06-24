variable "subscription_id" {
  description = "Azure subscription ID"
  type        = string
  default     = "44542832-156a-4b4e-a4fd-5a182428ca1e"
}

variable "resource_group" {
  description = "Resource group containing shared platform resources"
  type        = string
  default     = "rg-selfheal-staging"
}

variable "aks_cluster_name" {
  description = "Name of the shared AKS cluster"
  type        = string
  default     = "aks-selfheal-staging"
}

variable "acr_name" {
  description = "Azure Container Registry name (no .azurecr.io suffix)"
  type        = string
  default     = "acrselfhealstg"
}
