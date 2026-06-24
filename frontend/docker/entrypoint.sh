#!/bin/sh
# frontend/docker/entrypoint.sh
#
# Runtime entrypoint for the containerised frontend.
#
# Vite bakes VITE_* variables at build time, so a static image cannot be
# reconfigured at deploy time without a mechanism to inject the live values.
# This script replaces __VITE_<VAR>__ placeholder tokens embedded in the
# built JS/HTML bundle with the actual environment-variable values, then
# hands off to nginx.
#
# Usage (in Dockerfile):
#   ENTRYPOINT ["/docker/entrypoint.sh"]
#
# Requirements:
#   - Built assets must be placed at /usr/share/nginx/html (or override via DIST_DIR).
#   - Any VITE_ env var whose value should be injected at runtime must have
#     a corresponding __VITE_<VAR>__ placeholder baked into the bundle during
#     the build step (e.g. VITE_SUPABASE_URL -> __VITE_SUPABASE_URL__).

set -eu

DIST_SRC_DIR="${DIST_SRC_DIR:-/usr/share/nginx/html}"
DIST_DIR="${DIST_DIR:-/tmp/frontend-dist}"

prepare_dist_dir() {
  mkdir -p "${DIST_DIR}"

  if [ ! -d "${DIST_SRC_DIR}" ]; then
    echo "Missing source assets directory: ${DIST_SRC_DIR}" >&2
    exit 1
  fi

  if [ ! -f "${DIST_SRC_DIR}/index.html" ]; then
    echo "Missing built frontend assets in ${DIST_SRC_DIR}" >&2
    exit 1
  fi

  # Copy immutable baked assets into a writable location before runtime token
  # injection. This keeps compatibility with readOnlyRootFilesystem deployments.
  find "${DIST_DIR}" -mindepth 1 -delete || {
    echo "Failed to clean ${DIST_DIR}" >&2
    exit 1
  }
  cp -R "${DIST_SRC_DIR}/." "${DIST_DIR}/" || {
    echo "Failed to copy assets from ${DIST_SRC_DIR} to ${DIST_DIR}" >&2
    exit 1
  }
}

# Copy static assets from the read-only source dir to the writable dist dir.
# Required when nginx serves from a tmpfs (writable) path but assets are
# baked into an immutable image layer at DIST_SRC_DIR.
if [ -n "$DIST_SRC_DIR" ] && [ "$DIST_SRC_DIR" != "$DIST_DIR" ]; then
  mkdir -p "$DIST_DIR"
  cp -a "${DIST_SRC_DIR}/." "$DIST_DIR/"
fi

inject_env_vars() {
  # Iterate over all VITE_* environment variables and replace their
  # placeholder tokens in the built static assets.
  for var in $(env | grep -E "^VITE_" | cut -d= -f1); do
    # Use eval to safely dereference the variable name.
    value="$(eval "echo \"\${${var}}\"")"
    placeholder="__${var}__"

    # Replace in all JS and HTML files; silently skip files that do not
    # contain the placeholder to avoid spurious errors.
    find "${DIST_DIR}" \( -name "*.js" -o -name "*.html" \) \
      -exec sed -i "s|${placeholder}|${value}|g" {} \; 2>/dev/null || true
  done
}

prepare_dist_dir
inject_env_vars

# Exec nginx so it becomes PID 1 and receives signals correctly.
exec nginx -g "daemon off;"
