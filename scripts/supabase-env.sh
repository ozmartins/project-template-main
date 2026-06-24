#!/usr/bin/env bash
# Emits `export VAR=value` lines mapping the keys printed by `supabase status`
# to the variable names this stack's docker-compose expects.
#
# Local Supabase signing keys are generated PER INSTANCE (newer CLIs use
# asymmetric ES256 keys with an instance-specific key id), so they cannot be
# committed to .env.example -- `make up` sources them live via this script and
# exports them into the environment docker compose reads.
set -euo pipefail

status="$(supabase status -o env)"
get() { printf '%s\n' "$status" | sed -n "s/^$1=\"\\(.*\\)\"\$/\\1/p"; }

anon="$(get ANON_KEY)"
service="$(get SERVICE_ROLE_KEY)"

if [ -z "$anon" ] || [ -z "$service" ]; then
  echo "supabase-env.sh: could not read keys from 'supabase status' -- is Supabase running?" >&2
  exit 1
fi

printf 'export SUPABASE_ANON_KEY=%s\n' "$anon"
printf 'export SUPABASE_SERVICE_ROLE_KEY=%s\n' "$service"
printf 'export VITE_SUPABASE_ANON_KEY=%s\n' "$anon"
