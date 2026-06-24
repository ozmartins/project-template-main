# ---------------------------------------------------------------------------
# Azure Front Door — only created when cloud == "azure"
# Attaches a new endpoint + origin group to the SHARED AFD profile.
# Each app gets its own endpoint; no cross-app sharing.
# ---------------------------------------------------------------------------

locals {
  create_afd = var.cloud == "azure" && var.afd_profile_name != ""
}

data "azurerm_cdn_frontdoor_profile" "shared" {
  count               = local.create_afd ? 1 : 0
  name                = var.afd_profile_name
  resource_group_name = var.afd_resource_group
}

resource "azurerm_cdn_frontdoor_endpoint" "app" {
  count                    = local.create_afd ? 1 : 0
  name                     = "${var.app_name}-${var.environment}"
  cdn_frontdoor_profile_id = data.azurerm_cdn_frontdoor_profile.shared[0].id
  tags                     = local.azure_tags
}

resource "azurerm_cdn_frontdoor_origin_group" "app" {
  count                    = local.create_afd ? 1 : 0
  name                     = "${var.app_name}-${var.environment}"
  cdn_frontdoor_profile_id = data.azurerm_cdn_frontdoor_profile.shared[0].id

  load_balancing {
    sample_size                 = 4
    successful_samples_required = 3
  }
  health_probe {
    path                = "/"
    request_type        = "HEAD"
    protocol            = "Http"
    interval_in_seconds = 100
  }
}

resource "azurerm_cdn_frontdoor_origin" "app" {
  count                         = local.create_afd ? 1 : 0
  name                          = "frontend-lb"
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.app[0].id

  enabled                        = true
  host_name                      = local.frontend_lb_ip
  http_port                      = 80
  https_port                     = 443
  origin_host_header             = local.frontend_lb_ip
  priority                       = 1
  weight                         = 1000
  certificate_name_check_enabled = false
}

resource "azurerm_cdn_frontdoor_route" "app" {
  count                         = local.create_afd ? 1 : 0
  name                          = "default"
  cdn_frontdoor_endpoint_id     = azurerm_cdn_frontdoor_endpoint.app[0].id
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.app[0].id
  cdn_frontdoor_origin_ids      = [azurerm_cdn_frontdoor_origin.app[0].id]

  supported_protocols    = ["Http", "Https"]
  patterns_to_match      = ["/*"]
  forwarding_protocol    = "HttpOnly"
  https_redirect_enabled = true
  link_to_default_domain = true
}

# The frontend service LB IP is not known until Helm deploys.
# We look it up after the Helm release settles.
locals {
  frontend_lb_ip = local.create_afd ? data.kubernetes_service.frontend_lb[0].status[0].load_balancer[0].ingress[0].ip : ""
}

data "kubernetes_service" "frontend_lb" {
  count = local.create_afd ? 1 : 0
  metadata {
    name      = "${local.app_release_name}-frontend"
    namespace = local.app_ns
  }

  depends_on = [helm_release.app]
}
