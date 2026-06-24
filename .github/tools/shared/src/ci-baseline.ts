/**
 * ci-baseline.ts — shared CI baseline-attribution utilities.
 *
 * Separates pre-existing `main` failures from PR-introduced failures and
 * classifies PR-layer `action_required` runs so factory agents can make
 * correct attribution decisions without opening duplicate remediation tickets.
 *
 * The pure `attributeCiFailures` function is exported so it can be unit
 * tested without needing to invoke the GitHub CLI.
 */

export interface CiCheckAttribution {
  /** True when the same check name has a recent failure on the default branch. */
  pre_existing_on_main: boolean;
  /** Run IDs of the matching main-branch failures, for incident linkage. */
  main_failure_run_ids: number[];
  /** True when the check is in an `action_required` PR-layer state (not a code failure). */
  is_action_required: boolean;
  /** True when the check is cancelled on the PR and should be rerun before nudging. */
  is_cancelled: boolean;
}

export interface CiBaselineResult {
  baseline_branch: string;
  attribution: Record<string, CiCheckAttribution>;
  summary: {
    total_checks: number;
    pre_existing_on_main: number;
    action_required_count: number;
    cancelled_count: number;
    pr_introduced_failures: number;
  };
}

/**
 * Returns true for conclusions that represent a meaningful failure on the
 * default branch: actual failures and timed-out runs. Exported so tool-layer
 * code can reuse the same logic without duplicating the failure-state set.
 */
export function isFailureConclusion(conclusion: string): boolean {
  return (
    conclusion === "failure" ||
    conclusion === "FAILURE" ||
    conclusion === "timed_out" ||
    conclusion === "TIMED_OUT" ||
    conclusion === "startup_failure" ||
    conclusion === "STARTUP_FAILURE"
  );
}

/** Returns true for conclusions/states that indicate a cancelled check/run. */
export function isCancelledConclusion(conclusion: string): boolean {
  return conclusion === "cancelled" || conclusion === "CANCELLED";
}

/**
 * Pure attribution function: classifies each failing check as pre-existing on
 * main, a PR-layer action_required gate, or a genuine PR-introduced failure.
 *
 * @param failingCheckNames   Names of checks that are in a failing state on the PR.
 * @param actionRequiredCheckNames  Names of checks that are in action_required on the PR.
 * @param mainRuns  Recent workflow runs on the default branch (last ~20 is enough).
 * @param baselineBranch  The default branch name (used in the returned result).
 */
export function attributeCiFailures(
  failingCheckNames: string[],
  actionRequiredCheckNames: string[],
  mainRuns: Array<{ name: string; conclusion: string; databaseId: number }>,
  baselineBranch: string = "main",
  cancelledCheckNames: string[] = []
): CiBaselineResult {
  const attribution: Record<string, CiCheckAttribution> = {};

  // Classify each failing check against main
  for (const checkName of failingCheckNames) {
    const matchingMainRuns = mainRuns.filter(
      (r) => checkName === r.name || checkName.startsWith(`${r.name} / `)
    );
    const isPreExistingOnMain = matchingMainRuns.some((r) => isFailureConclusion(r.conclusion));
    attribution[checkName] = {
      pre_existing_on_main: isPreExistingOnMain,
      main_failure_run_ids: matchingMainRuns
        .filter((r) => isFailureConclusion(r.conclusion))
        .map((r) => r.databaseId),
      is_action_required: actionRequiredCheckNames.includes(checkName),
      is_cancelled: cancelledCheckNames.includes(checkName),
    };
  }

  // Record action_required checks that are not already in failing_checks
  for (const checkName of actionRequiredCheckNames) {
    if (!attribution[checkName]) {
      attribution[checkName] = {
        pre_existing_on_main: false,
        main_failure_run_ids: [],
        is_action_required: true,
        is_cancelled: false,
      };
    } else {
      attribution[checkName].is_action_required = true;
    }
  }

  for (const checkName of cancelledCheckNames) {
    if (!attribution[checkName]) {
      attribution[checkName] = {
        pre_existing_on_main: false,
        main_failure_run_ids: [],
        is_action_required: false,
        is_cancelled: true,
      };
    } else {
      attribution[checkName].is_cancelled = true;
    }
  }

  const allChecks = Object.values(attribution);
  const preExistingCount = allChecks.filter((a) => a.pre_existing_on_main).length;
  const actionRequiredCount = allChecks.filter((a) => a.is_action_required).length;
  const cancelledCount = allChecks.filter((a) => a.is_cancelled).length;
  const prIntroducedCount = allChecks.filter(
    (a) => !a.pre_existing_on_main && !a.is_action_required && !a.is_cancelled
  ).length;

  return {
    baseline_branch: baselineBranch,
    attribution,
    summary: {
      total_checks: allChecks.length,
      pre_existing_on_main: preExistingCount,
      action_required_count: actionRequiredCount,
      cancelled_count: cancelledCount,
      pr_introduced_failures: prIntroducedCount,
    },
  };
}
