type PermissionRequest = {
  kind: string;
  fullCommandText?: string;
};

type PermissionDecision = { kind: "approve-once" } | { kind: "reject" };

export type PermissionHandler = (
  request: PermissionRequest,
  context?: { sessionId: string }
) => PermissionDecision;

// Default profile: approve one request at a time.
export const approveAll: PermissionHandler = () => ({ kind: "approve-once" });

// Read-only profile: deny shell writes
export const readOnlyHandler: PermissionHandler = (request) => {
  if (request.kind === "shell") {
    const mutating = /\b(gh issue edit|gh issue create|gh pr edit|gh pr create|gh label)\b/;
    if (mutating.test(request.fullCommandText ?? "")) return { kind: "reject" };
  }
  return approveAll(request, { sessionId: "" });
};
