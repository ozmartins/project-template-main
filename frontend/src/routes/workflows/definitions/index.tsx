/**
 * Workflow Definitions Route — /workflows/definitions
 *
 * Definition promotion UI: lists all workflow definitions with status badges,
 * shows a diff view for pending-review definitions, and provides Approve / Reject
 * actions that write to the audit log and activate the canonical deployment path.
 */

import { createFileRoute } from "@tanstack/react-router";
import { WorkflowDefinitionsPage } from "@/components/engine/WorkflowDefinitionsPage";

export const Route = createFileRoute("/workflows/definitions/")({
  component: WorkflowDefinitionsPage,
});
