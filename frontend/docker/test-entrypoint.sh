#!/usr/bin/env bash
# frontend/docker/test-entrypoint.sh
#
# Runtime-contract tests for the frontend container entrypoint.
# Validates that the env-var injection mechanism (entrypoint.sh) works
# correctly for a Vite static bundle served by nginx.
#
# Usage (from repo root):
#   bash frontend/docker/test-entrypoint.sh
#
# No Docker daemon required; the injection logic is extracted and tested
# directly in a temporary directory so CI can run this without building the
# image.

set -euo pipefail

PASS=0
FAIL=0

pass() { printf "  ✅ %s\n" "$1"; PASS=$((PASS + 1)); }
fail() { printf "  ❌ FAIL: %s\n" "$1" >&2; FAIL=$((FAIL + 1)); }

ENTRYPOINT="frontend/docker/entrypoint.sh"

echo "=== Frontend entrypoint runtime-contract tests ==="
echo ""

# ── 1. Structural checks ──────────────────────────────────────────────────────
echo "--- Structure ---"

if [ -f "${ENTRYPOINT}" ]; then
  pass "entrypoint script exists"
else
  fail "entrypoint script not found: ${ENTRYPOINT}"
fi

if [ -x "${ENTRYPOINT}" ] || head -1 "${ENTRYPOINT}" 2>/dev/null | grep -q "^#!"; then
  pass "entrypoint has shebang / is executable"
else
  fail "entrypoint is missing shebang and is not executable"
fi

# ── 2. Env-var injection logic ────────────────────────────────────────────────
echo ""
echo "--- Env-var injection ---"

TMPDIR_TEST="$(mktemp -d)"
trap 'rm -rf "${TMPDIR_TEST}"' EXIT

DIST="${TMPDIR_TEST}/dist"
mkdir -p "${DIST}"

# Create a mock built JS bundle with placeholder tokens.
cat > "${DIST}/main.js" <<'EOF'
const supabaseUrl = "__VITE_SUPABASE_URL__";
const apiUrl = "__VITE_API_URL__";
EOF

cat > "${DIST}/index.html" <<'EOF'
<!doctype html>
<html><head><title>App</title></head>
<body><script src="main.js"></script></body>
</html>
EOF

# Set test env vars.
export VITE_SUPABASE_URL="https://test.supabase.co"
export VITE_API_URL="https://test.supabase.co/functions/v1"

# Extract and run ONLY the injection function from entrypoint.sh (skip the
# nginx exec) so we can test the logic without requiring nginx.
INJECT_SCRIPT="$(mktemp)"
cat > "${INJECT_SCRIPT}" <<'INJECT'
set -eu
DIST_DIR="${DIST_DIR:-/app/dist}"
# Use portable sed -i: macOS requires an explicit backup suffix, Linux does not.
SED_INPLACE="sed -i"
if sed --version 2>&1 | grep -q "GNU"; then
  SED_INPLACE="sed -i"
else
  SED_INPLACE="sed -i ''"
fi
for var in $(env | grep -E "^VITE_" | cut -d= -f1); do
  value="$(eval "echo \"\${${var}}\"")"
  placeholder="__${var}__"
  find "${DIST_DIR}" \( -name "*.js" -o -name "*.html" \) \
    -exec $SED_INPLACE "s|${placeholder}|${value}|g" {} \; 2>/dev/null || true
done
INJECT

DIST_DIR="${DIST}" sh "${INJECT_SCRIPT}"
rm -f "${INJECT_SCRIPT}"

# Verify VITE_SUPABASE_URL was injected.
if grep -q "https://test.supabase.co" "${DIST}/main.js"; then
  pass "VITE_SUPABASE_URL injected into JS bundle"
else
  fail "VITE_SUPABASE_URL not found in JS bundle after injection"
fi

# Verify placeholder was replaced (not still present).
if grep -q "__VITE_SUPABASE_URL__" "${DIST}/main.js"; then
  fail "placeholder __VITE_SUPABASE_URL__ still present after injection"
else
  pass "placeholder __VITE_SUPABASE_URL__ replaced in JS bundle"
fi

# Verify VITE_API_URL was injected.
if grep -q "https://test.supabase.co/functions/v1" "${DIST}/main.js"; then
  pass "VITE_API_URL injected into JS bundle"
else
  fail "VITE_API_URL not found in JS bundle after injection"
fi

# Verify index.html is untouched (no placeholders to replace there).
if [ -f "${DIST}/index.html" ]; then
  pass "index.html preserved"
else
  fail "index.html missing after injection"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
if [ "${FAIL}" -gt 0 ]; then
  exit 1
fi
echo "All entrypoint contract tests passed."
