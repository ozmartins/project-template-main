variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "eks_cluster_name" {
  type    = string
  default = "dev-eks-cluster"
}

variable "node_role_arn" {
  description = "IAM role ARN for EKS managed node group"
  type        = string
  default     = "arn:aws:iam::354918379520:role/default-eks-node-group-20250425194654601800000006"
}
