output "app_namespace" {
  description = "Kubernetes namespace where the app is deployed"
  value       = local.app_ns
}

output "supabase_namespace" {
  description = "Kubernetes namespace where Supabase is deployed"
  value       = local.supabase_ns
}

output "vault_namespace" {
  description = "Kubernetes namespace where OpenBao is deployed"
  value       = local.vault_ns
}

output "supabase_internal_url" {
  description = "Cluster-internal Supabase Kong URL"
  value       = local.supabase_internal_url
}

output "temporal_namespace" {
  description = "Temporal namespace registered for this app"
  value       = local.temporal_namespace
}

output "temporal_task_queue" {
  description = "Temporal task queue for this app"
  value       = local.temporal_task_queue
}

output "afd_endpoint_hostname" {
  description = "Azure Front Door endpoint hostname (empty if not Azure)"
  value       = local.create_afd ? azurerm_cdn_frontdoor_endpoint.app[0].host_name : ""
}

output "cloudfront_domain" {
  description = "CloudFront distribution domain name (empty if not AWS)"
  value       = local.create_cf ? aws_cloudfront_distribution.app[0].domain_name : ""
}

output "public_url" {
  description = "Public URL for this app instance"
  value = (
    local.create_afd ? "https://${azurerm_cdn_frontdoor_endpoint.app[0].host_name}" :
    local.create_cf ? "https://${aws_cloudfront_distribution.app[0].domain_name}" :
    "http://localhost"
  )
}

output "gha_kubeconfig_secret_name" {
  description = "GitHub Actions secret name for the kubeconfig"
  value       = "KUBECONFIG_${upper(replace("${var.app_name}_${var.environment}", "-", "_"))}"
}
