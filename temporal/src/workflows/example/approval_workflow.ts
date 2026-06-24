import { condition, defineQuery, defineSignal, setHandler } from "@temporalio/workflow";

export interface ApprovalRequest {
  entity_id: string;
  entity_type: string;
  requested_by: string;
  approvers: string[];
  timeout_hours?: number;
}

export interface ApprovalDecision {
  approved: boolean;
  decided_by: string;
  comments?: string;
}

export interface ApprovalResult {
  entity_id: string;
  status: "approved" | "rejected";
  decision: ApprovalDecision;
}

export const submitDecisionSignal = defineSignal<[ApprovalDecision]>("submit_decision");
export const getStatusQuery = defineQuery<string>("get_status");

export async function ApprovalWorkflow(request: ApprovalRequest): Promise<ApprovalResult> {
  let status = "pending_approval";
  let decision: ApprovalDecision | null = null;

  setHandler(submitDecisionSignal, (d: ApprovalDecision) => {
    decision = d;
  });
  setHandler(getStatusQuery, () => status);

  const timeoutMs = (request.timeout_hours ?? 24) * 3_600_000;
  const received = await condition(() => decision !== null, timeoutMs);

  if (!received || decision === null) {
    decision = { approved: false, decided_by: "system", comments: "Timed out" } as ApprovalDecision;
    status = "rejected";
  } else {
    status = (decision as ApprovalDecision).approved ? "approved" : "rejected";
  }

  return {
    entity_id: request.entity_id,
    status: status as "approved" | "rejected",
    decision,
  };
}
