/**
 * Run all architecture-audit checks and report findings.
 *
 * Usage:
 *   npm run audit              # report mode (always exit 0)
 *   npm run audit -- --strict  # exit 1 if any findings (gating)
 *
 * Report mode is the default so the audit surfaces a worklist without blocking
 * merges (existing tracked defects are expected). Promote to --strict per-check
 * once the corresponding tracking issues are closed.
 */

import { run as checkTemporalRegistration } from "./check-temporal-registration.js";
import { run as checkViewSecurityInvoker } from "./check-view-security-invoker.js";
import { run as checkWorkflowSecurity } from "./check-workflow-security.js";
import { emit } from "./common.js";

const strict = process.argv.includes("--strict");

const results = [checkTemporalRegistration(), checkWorkflowSecurity(), checkViewSecurityInvoker()];

emit(results);

const total = results.reduce((sum, r) => sum + r.findings.length, 0);
if (total > 0) {
  process.stderr.write(`\nArchitecture audit: ${total} finding(s).\n`);
}

process.exit(strict && total > 0 ? 1 : 0);
