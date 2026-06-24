variable "aks_host" {
  description = "AKS API server URL"
  type        = string
}

variable "aks_ca_cert" {
  description = "Base64-encoded AKS CA certificate"
  type        = string
  sensitive   = true
}

variable "tenant_id" {
  description = "Azure AD tenant ID"
  type        = string
}

variable "client_id" {
  description = "Service principal client ID for AKS auth"
  type        = string
}

variable "client_secret" {
  description = "Service principal client secret for AKS auth"
  type        = string
  sensitive   = true
}

variable "acr_username" {
  description = "ACR admin username"
  type        = string
}

variable "acr_password" {
  description = "ACR admin password"
  type        = string
  sensitive   = true
}

variable "github_token" {
  description = "GitHub PAT with repo-secrets:write scope"
  type        = string
  sensitive   = true
}

variable "aks_token" {
  description = "Static bearer token for local applies (skips kubelogin exec). Leave empty in CI."
  type        = string
  default     = ""
  sensitive   = true
}
