# ---------------------------------------------------------------------------
# Temporal namespace registration — idempotent via local-exec
# Requires temporal-admintools pod in the shared 'dev' namespace.
# ---------------------------------------------------------------------------

resource "null_resource" "temporal_namespace" {
  triggers = {
    namespace = local.temporal_namespace
  }

  provisioner "local-exec" {
    command = <<-EOF
      set -euo pipefail
      ADMINTOOLS=$(kubectl get pod -n dev -l app.kubernetes.io/component=admintools -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || \
                   kubectl get pod -n dev -l app.kubernetes.io/name=admintools -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || \
                   kubectl get pod -n dev -l app=temporal-admintools -o jsonpath='{.items[0].metadata.name}')
      kubectl exec -n dev "$ADMINTOOLS" -- \
        temporal operator namespace describe ${local.temporal_namespace} 2>/dev/null || \
        kubectl exec -n dev "$ADMINTOOLS" -- \
          temporal operator namespace create ${local.temporal_namespace}
    EOF
  }
}
