#!/usr/bin/env bash
set -euo pipefail

output_path="${1:-deploy/azure/afd-backend-cidrs.txt}"
location="${AZURE_LOCATION:-eastus}"
tmp_file="$(mktemp)"

cleanup() {
  rm -f "$tmp_file"
}
trap cleanup EXIT

az network list-service-tags \
  --location "$location" \
  --query "values[?name=='AzureFrontDoor.Backend'].properties.addressPrefixes[]" \
  -o tsv \
  | sed '/^[[:space:]]*$/d' \
  | sort -u > "$tmp_file"

if [[ ! -s "$tmp_file" ]]; then
  echo "No AzureFrontDoor.Backend address prefixes were returned for location '$location'." >&2
  exit 1
fi

mkdir -p "$(dirname "$output_path")"
mv "$tmp_file" "$output_path"
