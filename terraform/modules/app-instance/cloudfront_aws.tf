# ---------------------------------------------------------------------------
# AWS CloudFront — only created when cloud == "aws"
# Mirrors the AFD pattern: per-app distribution → NLB IP.
# ---------------------------------------------------------------------------

locals {
  create_cf = var.cloud == "aws"
}

resource "aws_cloudfront_distribution" "app" {
  count = local.create_cf ? 1 : 0

  enabled             = true
  comment             = "${var.app_name} ${var.environment}"
  default_root_object = ""

  origin {
    origin_id   = "frontend-nlb"
    domain_name = local.frontend_nlb_dns

    custom_origin_config {
      http_port              = 8080
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "frontend-nlb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]

    forwarded_values {
      query_string = true
      headers      = ["*"]
      cookies {
        forward = "all"
      }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = local.common_labels
}

locals {
  frontend_nlb_dns = local.create_cf ? try(data.kubernetes_service.frontend_nlb[0].status[0].load_balancer[0].ingress[0].hostname, "") : ""
}

data "kubernetes_service" "frontend_nlb" {
  count = local.create_cf ? 1 : 0
  metadata {
    name      = "${local.app_release_name}-frontend"
    namespace = local.app_ns
  }

  depends_on = [helm_release.app]
}
