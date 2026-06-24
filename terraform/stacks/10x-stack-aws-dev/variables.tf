variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "eks_cluster_name" {
  description = "EKS cluster name"
  type        = string
  default     = "dev-eks-cluster"
}

variable "github_token" {
  description = "GitHub PAT with repo-secrets write permission"
  type        = string
  sensitive   = true
}
