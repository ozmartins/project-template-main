# ---------------------------------------------------------------------------
# Credential generation — all auto-generated, never committed to git
# ---------------------------------------------------------------------------

resource "random_password" "supabase_db" {
  length  = 32
  special = false
}

resource "random_password" "supabase_dashboard" {
  length  = 24
  special = false
}

resource "random_bytes" "supabase_jwt_secret" {
  length = 48
}

locals {
  jwt_secret = base64encode(random_bytes.supabase_jwt_secret.base64)

  # Standard Supabase JWT structure — HS256 signed with jwt_secret.
  # These are computed locally; signing is done by Terraform's bcrypt/base64
  # builtins since we can't run openssl here. The tokens use the same fixed
  # iat/exp as the official Supabase self-hosted defaults (valid until 2033).
  jwt_header          = base64encode(jsonencode({ alg = "HS256", typ = "JWT" }))
  anon_payload        = base64encode(jsonencode({ role = "anon", iss = "supabase", iat = 1700000000, exp = 2015360000 }))
  service_payload     = base64encode(jsonencode({ role = "service_role", iss = "supabase", iat = 1700000000, exp = 2015360000 }))
}

# Supabase does not provide a Terraform provider for JWT signing.
# We generate the JWTs via a null_resource shell script (requires jq + openssl on the runner).
# The tokens are stored in local files scoped to the workspace and read back as data sources.
resource "null_resource" "generate_supabase_jwts" {
  triggers = {
    jwt_secret_hash = sha256(local.jwt_secret)
  }

  provisioner "local-exec" {
    command = <<-EOF
      set -euo pipefail
      SECRET="${local.jwt_secret}"

      b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

      H=$(echo -n '{"alg":"HS256","typ":"JWT"}' | b64url)
      AP=$(echo -n '{"role":"anon","iss":"supabase","iat":1700000000,"exp":2015360000}' | b64url)
      AS=$(echo -n "$H.$AP" | openssl dgst -sha256 -hmac "$SECRET" -binary | b64url)
      echo "$H.$AP.$AS" > ${path.module}/.supabase_anon_key

      SP=$(echo -n '{"role":"service_role","iss":"supabase","iat":1700000000,"exp":2015360000}' | b64url)
      SS=$(echo -n "$H.$SP" | openssl dgst -sha256 -hmac "$SECRET" -binary | b64url)
      echo "$H.$SP.$SS" > ${path.module}/.supabase_service_key
    EOF
  }
}

data "local_file" "supabase_anon_key" {
  filename   = "${path.module}/.supabase_anon_key"
  depends_on = [null_resource.generate_supabase_jwts]
}

data "local_file" "supabase_service_key" {
  filename   = "${path.module}/.supabase_service_key"
  depends_on = [null_resource.generate_supabase_jwts]
}

# ---------------------------------------------------------------------------
# Supabase Helm release
# ---------------------------------------------------------------------------

resource "helm_release" "supabase" {
  name       = "supabase"
  repository = "https://supabase-community.github.io/supabase-kubernetes"
  chart      = "supabase"
  version    = var.supabase_chart_version
  namespace  = kubernetes_namespace.supabase.metadata[0].name
  timeout    = 600

  # Disable components not needed for this template
  set {
    name  = "deployment.studio.enabled"
    value = "false"
  }
  set {
    name  = "deployment.analytics.enabled"
    value = "false"
  }
  set {
    name  = "deployment.functions.enabled"
    value = "false"
  }
  set {
    name  = "deployment.imgproxy.enabled"
    value = "false"
  }
  set {
    name  = "deployment.vector.enabled"
    value = "false"
  }
  set {
    name  = "deployment.storage.enabled"
    value = "false"
  }

  # Persistence
  set {
    name  = "persistence.db.enabled"
    value = "true"
  }
  set {
    name  = "persistence.db.size"
    value = var.supabase_db_size
  }
  set {
    name  = "persistence.db.storageClassName"
    value = var.supabase_storage_class
  }

  # Auto-generated credentials
  set_sensitive {
    name  = "secret.db.password"
    value = random_password.supabase_db.result
  }
  set_sensitive {
    name  = "secret.dashboard.username"
    value = "supabase"
  }
  set_sensitive {
    name  = "secret.dashboard.password"
    value = random_password.supabase_dashboard.result
  }
  set_sensitive {
    name  = "secret.jwt.secret"
    value = local.jwt_secret
  }
  set_sensitive {
    name  = "secret.jwt.anonKey"
    value = trimspace(data.local_file.supabase_anon_key.content)
  }
  set_sensitive {
    name  = "secret.jwt.serviceKey"
    value = trimspace(data.local_file.supabase_service_key.content)
  }

  depends_on = [
    kubernetes_namespace.supabase,
    null_resource.generate_supabase_jwts,
  ]
}
