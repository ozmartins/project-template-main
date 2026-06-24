import { createHash } from "node:crypto";

export function fingerprint(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 12);
}

export function fingerprintId(prefix: string, parts: string[]): string {
  return `${prefix}-${fingerprint(parts)}`;
}

export function fingerprintComment(id: string): string {
  return `<!-- fingerprint:${id} -->`;
}

export function fingerprintSearchToken(id: string): string {
  return `fingerprint:${id}`;
}

export function extractFingerprint(text: string): string | null {
  const match = text.match(/<!-- fingerprint:([\w:-]+) -->/);
  return match ? (match[1] ?? null) : null;
}

/**
 * Normalize an arbitrary string so it can be used safely as a fingerprint part
 * or stable identifier slug. Lowercases, replaces any run of non-alphanumeric
 * characters (including slashes, underscores, dots, etc.) with a single hyphen,
 * and trims leading/trailing hyphens.
 *
 * Motivation: deploy job/step names can contain "/" in one run and "-" in
 * another (e.g. "bootstrap/secret" vs "bootstrap-secret"), which would
 * otherwise produce different fingerprint hashes for the same failure family.
 */
export function normalizeFingerprintPart(part: string): string {
  return part
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Stable fingerprint IDs for deploy/E2E workflow failure families.
 * These map GitHub Actions workflow display names (as reported in
 * `github.event.workflow_run.name`) to a canonical slug used in issue
 * fingerprint comments so that every re-trigger of the same failing
 * workflow always resolves to the same open incident.
 */
const DEPLOY_FAMILY_MAP: Record<string, string> = {
  "deploy - dev": "deploy-dev-failure",
  "deploy dev": "deploy-dev-failure",
  "test - e2e dev": "e2e-dev-failure",
  "test e2e dev": "e2e-dev-failure",
};

/**
 * Return the stable fingerprint ID for a given deploy/E2E workflow name.
 * Falls back to a normalised slug derived from the workflow name so that
 * unknown workflows still get a reproducible (if unrecognised) fingerprint.
 */
export function deployFamilyFingerprintId(workflowName: string): string {
  const key = workflowName.toLowerCase().trim();
  return DEPLOY_FAMILY_MAP[key] ?? normalizeFingerprintPart(`deploy-${workflowName}-failure`);
}
