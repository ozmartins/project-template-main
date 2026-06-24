#!/usr/bin/env bash
set -euo pipefail

mode="${1:-}"

write_output() {
  local line="$1"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "$line" >> "$GITHUB_OUTPUT"
  else
    echo "$line"
  fi
}

case "$mode" in
  push-gate)
    is_tracked_push="${IS_TRACKED_PUSH:-false}"
    write_output "is_tracked_push=$is_tracked_push"

    if [[ "$is_tracked_push" == "true" && -n "${REGISTRY:-}" && -n "${REGISTRY_USERNAME:-}" && -n "${REGISTRY_PASSWORD:-}" ]]; then
      write_output "enabled=true"
    else
      write_output "enabled=false"
    fi
    ;;

  ecr-push-gate)
    if [[ -n "${ECR_REGISTRY:-}" && -n "${AWS_ROLE_TO_ASSUME:-}" && -n "${AWS_REGION:-}" ]]; then
      write_output "enabled=true"
      write_output "registry=${ECR_REGISTRY}"
      write_output "region=${AWS_REGION}"
    else
      write_output "enabled=false"
      write_output "registry="
      write_output "region="
    fi
    ;;

  image-tags)
    if [[ -z "${GITHUB_SHA:-}" ]]; then
      echo "image-tags mode: GITHUB_SHA is required" >&2
      exit 1
    fi
    if [[ "${#GITHUB_SHA}" -lt 12 ]]; then
      echo "image-tags mode: GITHUB_SHA must be at least 12 characters" >&2
      exit 1
    fi

    if [[ -z "${IMAGE_NAME:-}" ]]; then
      echo "image-tags mode: IMAGE_NAME is required" >&2
      exit 1
    fi

    if [[ ! "${IMAGE_NAME}" =~ ^[a-z0-9]+([._-][a-z0-9]+)*$ ]]; then
      echo "image-tags mode: IMAGE_NAME must use lowercase letters, numbers, dots, underscores, and dashes only" >&2
      exit 1
    fi

    short_sha="${GITHUB_SHA:0:12}"
    if [[ -n "${REGISTRY:-}" ]]; then
      image_repo="${REGISTRY}/${IMAGE_NAME}"
    else
      image_repo="local/${IMAGE_NAME}"
    fi
    tags=("${image_repo}:${GITHUB_SHA}" "${image_repo}:${short_sha}")
    mutable_tag=""

    # Add a mutable convenience tag for tracked branches.
    # dev branch → dev-latest; main branch → latest.
    case "${GITHUB_REF:-}" in
      refs/heads/dev)
        mutable_tag="dev-latest"
        ;;
      refs/heads/main)
        mutable_tag="latest"
        ;;
    esac

    if [[ -n "$mutable_tag" ]]; then
      tags+=("${image_repo}:${mutable_tag}")
    fi

    # Also push to ECR when AWS_ECR_REGISTRY var is set.
    if [[ -n "${ECR_REGISTRY:-}" ]]; then
      ecr_repo="${ECR_REGISTRY}/${IMAGE_NAME}"
      tags+=("${ecr_repo}:${GITHUB_SHA}" "${ecr_repo}:${short_sha}")
      if [[ -n "$mutable_tag" ]]; then
        tags+=("${ecr_repo}:${mutable_tag}")
      fi
    fi

    # Also push to ECR when AWS_ECR_REGISTRY var is set
    if [[ -n "${ECR_REGISTRY:-}" ]]; then
      ecr_repo="${ECR_REGISTRY}/${IMAGE_NAME}"
      tags+=("${ecr_repo}:${GITHUB_SHA}" "${ecr_repo}:${short_sha}" "${ecr_repo}:latest")
    fi

    if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
      {
        echo "tags<<EOF"
        printf '%s\n' "${tags[@]}"
        echo "EOF"
      } >> "$GITHUB_OUTPUT"
    else
      printf '%s\n' "${tags[@]}"
    fi
    ;;

  skip-message)
    echo "Image push skipped: set vars.ACR_LOGIN_SERVER and configure ACR_USERNAME/ACR_PASSWORD secrets to enable registry push."
    ;;

  *)
    echo "Usage: $0 {push-gate|ecr-push-gate|image-tags|skip-message}" >&2
    exit 1
    ;;
esac
