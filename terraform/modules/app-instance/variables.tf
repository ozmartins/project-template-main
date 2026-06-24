variable "app_name" {
  description = "Short name for this app instance, e.g. '10x-stack'. Used as prefix for all resources."
  type        = string
}

variable "environment" {
  description = "Deployment environment: dev | test | prod"
  type        = string
  validation {
    condition     = contains(["dev", "test", "prod"], var.environment)
    error_message = "environment must be dev, test, or prod"
  }
}

variable "cloud" {
  description = "Target cloud platform: azure | aws"
  type        = string
  default     = "azure"
  validation {
    condition     = contains(["azure", "aws"], var.cloud)
    error_message = "cloud must be azure or aws"
  }
}

# --- Platform prereqs (shared, not created by this module) ---

variable "acr_login_server" {
  description = "Container registry login server, e.g. acrselfhealstg.azurecr.io"
  type        = string
}

variable "acr_username" {
  description = "Container registry admin username"
  type        = string
  sensitive   = true
}

variable "acr_password" {
  description = "Container registry admin password"
  type        = string
  sensitive   = true
}

variable "temporal_address" {
  description = "Temporal frontend address reachable from within the cluster"
  type        = string
  default     = "temporal-frontend.dev.svc.cluster.local:7233"
}

variable "afd_profile_name" {
  description = "(Azure) Name of the existing AFD Standard profile to attach an endpoint to"
  type        = string
  default     = ""
}

variable "afd_resource_group" {
  description = "(Azure) Resource group containing the AFD profile"
  type        = string
  default     = ""
}

variable "supabase_chart_version" {
  description = "Supabase Helm chart version to deploy"
  type        = string
  default     = "0.5.6"
}

variable "supabase_storage_class" {
  description = "StorageClass for Supabase DB PVC"
  type        = string
  default     = "default"
}

variable "supabase_db_size" {
  description = "PVC size for Supabase DB"
  type        = string
  default     = "5Gi"
}

variable "openbao_image" {
  description = "OpenBao container image"
  type        = string
  default     = "openbao/openbao:2.5.4"
}

variable "openbao_storage_class" {
  description = "StorageClass for the OpenBao PVC"
  type        = string
  default     = "default"
}

variable "openbao_data_size" {
  description = "PVC size for the OpenBao data directory"
  type        = string
  default     = "1Gi"
}

variable "eso_api_version" {
  description = "API version for External Secrets Operator CRDs. v1beta1 for ESO <0.9, v1 for ESO >=0.9."
  type        = string
  default     = "v1beta1"
  validation {
    condition     = contains(["v1alpha1", "v1beta1", "v1"], var.eso_api_version)
    error_message = "eso_api_version must be v1alpha1, v1beta1, or v1"
  }
}

variable "github_repo" {
  description = "GitHub repo in org/name format, e.g. Volaris-AI/project-template"
  type        = string
}

variable "k8s_api_server" {
  description = "Kubernetes API server URL for GHA kubeconfig"
  type        = string
  default     = ""
}

variable "k8s_ca_data" {
  description = "Base64-encoded Kubernetes CA certificate for GHA kubeconfig"
  type        = string
  sensitive   = true
  default     = ""
}
