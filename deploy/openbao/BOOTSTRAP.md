# OpenBao bootstrap runbook (ADR-0042)

This runbook is for platform administrators bootstrapping OpenBao + External Secrets Operator in-cluster.

## 1) Install OpenBao (HA Raft)

```bash
helm repo add openbao https://openbao.github.io/openbao-helm
helm repo update

kubectl create namespace openbao
kubectl apply -f deploy/openbao/certificate.yaml
kubectl apply -f deploy/openbao/networkpolicy.yaml

helm upgrade --install openbao openbao/openbao \
  --namespace openbao \
  --values deploy/openbao/values-ha.yaml
```

`deploy/openbao/certificate.yaml` uses cert-manager with an internal namespace-scoped CA
issuer chain (`openbao-selfsigned-bootstrap` -> `openbao-internal-ca`) so the
`openbao-server-tls` certificate can be minted for cluster-local `.svc` names.

## 2) Initialize and unseal

Run the init once and store all unseal/recovery output in secure offline storage.
Recommended options: encrypted hardware-backed password manager with break-glass workflow, or encrypted removable media stored in a physical safe.

```bash
kubectl -n openbao exec -it openbao-0 -- bao operator init
```

Unseal three pods using three distinct key shares:

```bash
kubectl -n openbao exec -it openbao-0 -- bao operator unseal
kubectl -n openbao exec -it openbao-1 -- bao operator unseal
kubectl -n openbao exec -it openbao-2 -- bao operator unseal
```

Each unseal command should use a different key share from the init output.
When prompted, paste one key share per command; do not reuse the same share across all three pods.
Default Shamir setup requires 3 unique shares per pod (threshold 3/5), so repeat the command on each pod until it reports unsealed.

Do not commit unseal keys, recovery keys, root tokens, or snapshots to git.

## 3) Install External Secrets Operator

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm repo update

helm upgrade --install external-secrets external-secrets/external-secrets \
  -n external-secrets \
  --create-namespace \
  -f deploy/eso/values.yaml
```

This runbook and `deploy/openbao/networkpolicy.yaml` assume ESO runs in namespace `external-secrets`.
If you install ESO elsewhere, update the network policy namespace selector accordingly.

## 4) Enable Kubernetes auth backend

`deploy/openbao/networkpolicy.yaml` includes TCP/443 egress so OpenBao can reach the
Kubernetes API for token review during Kubernetes auth setup.
If your platform exposes a fixed API endpoint/CIDR, tighten that rule to the specific
destination after bootstrap.

```bash
kubectl -n openbao exec -it openbao-0 -- sh -ec \
  'apk add --no-cache curl >/dev/null 2>&1 || true; curl -skf https://kubernetes.default.svc:443/healthz'
```

```bash
kubectl -n openbao exec -it statefulset/openbao -- sh -ec '
  bao auth enable kubernetes || true
  bao write auth/kubernetes/config \
    kubernetes_host="https://kubernetes.default.svc:443"
'
```

This intentionally does **not** persist `token_reviewer_jwt`; OpenBao will use the
in-cluster pod service account token/CA files directly so token review continues to
work across projected token rotation.

## 5) Namespace least-privilege policy + role

Example for `<env>=prod` and `<namespace>=project-template-prod`:

```bash
kubectl -n openbao exec -it statefulset/openbao -- sh -ec '
cat <<EOF >/tmp/project-template-prod.hcl
path "secret/data/project-template/prod/frontend" {
  capabilities = ["read"]
}

path "secret/data/project-template/prod/backend" {
  capabilities = ["read"]
}
EOF

bao policy write project-template-prod-project-template-prod /tmp/project-template-prod.hcl

bao write auth/kubernetes/role/project-template-prod-project-template-prod \
  bound_service_account_names=external-secrets \
  bound_service_account_namespaces=project-template-prod \
  audience=vault \
  policies=project-template-prod-project-template-prod \
  ttl=1h
'
```

Create the application-namespace ServiceAccount referenced by the SecretStore:

```bash
kubectl apply -f deploy/openbao/external-secrets-serviceaccount-template.yaml
```

Then apply a namespace-scoped `SecretStore` from `deploy/openbao/secretstore-prod-template.yaml`, then create app `ExternalSecret` resources from the Helm chart.

## 6) Snapshot backup job

```bash
kubectl -n openbao exec -it statefulset/openbao -- sh -ec '
cat <<EOF >/tmp/openbao-snapshot.hcl
path "sys/storage/raft/snapshot" {
  capabilities = ["read"]
}
EOF
bao policy write openbao-snapshot /tmp/openbao-snapshot.hcl
bao token create -policy=openbao-snapshot -ttl=48h -explicit-max-ttl=168h -format=json
'

# create secret from the issued token value
kubectl -n openbao create secret generic openbao-snapshot-token \
  --from-literal=token=<SNAPSHOT_TOKEN_VALUE>

kubectl apply -f deploy/openbao/snapshot-cronjob.yaml
```

Provision `openbao-snapshot-token` with only `sys/storage/raft/snapshot` read capability.
Rotate this token regularly (at least weekly) and update the Kubernetes secret after rotation.
