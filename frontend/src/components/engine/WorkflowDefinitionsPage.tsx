/**
 * WorkflowDefinitionsPage — definition promotion UI.
 *
 * Shows all workflow definitions with status badges (live / pending-review / draft /
 * rejected).  Clicking a pending-review definition opens a side-by-side diff against
 * the currently live version.  Reviewers can Approve or Reject pending definitions;
 * every decision is written to workflow_definition_audit_log and, on approval, the
 * canonical deploy_workflow_definition() path activates the new version.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, ChevronRight, Clock, FileCode, XCircle } from "lucide-react";
import { useState } from "react";
import { useAuth, useAuthCapabilities } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/data/supabase";
import { cn } from "@/lib/utils";

// ── types ─────────────────────────────────────────────────────────────────

interface WorkflowDefinition {
  id: string;
  name: string;
  version: string;
  definition: Record<string, unknown>;
  description: string | null;
  is_active: boolean;
  review_status: "draft" | "pending-review" | "approved" | "rejected";
  created_at: string;
  updated_at: string;
  created_by: string | null;
  deployed_at: string | null;
}

interface AuditEntry {
  id: string;
  definition_name: string;
  action: string;
  actor_id: string;
  version: string;
  reason: string | null;
  created_at: string;
}

// ── query helpers ─────────────────────────────────────────────────────────

async function fetchDefinitions(): Promise<WorkflowDefinition[]> {
  const { data, error } = await supabase
    .from("workflow_definitions")
    .select("*")
    .order("name", { ascending: true })
    .order("version", { ascending: false });
  if (error) throw error;
  return data as WorkflowDefinition[];
}

async function fetchAuditLog(definitionId: string): Promise<AuditEntry[]> {
  const { data, error } = await supabase
    .from("workflow_definition_audit_log")
    .select("*")
    .eq("definition_id", definitionId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return data as AuditEntry[];
}

// ── status badge ──────────────────────────────────────────────────────────

function StatusBadge({ def }: { def: WorkflowDefinition }) {
  if (def.is_active) {
    return (
      <Badge className="bg-green-500/15 text-green-700 border-green-500/30 hover:bg-green-500/20">
        live
      </Badge>
    );
  }
  if (def.review_status === "pending-review") {
    return (
      <Badge className="bg-yellow-500/15 text-yellow-700 border-yellow-500/30 hover:bg-yellow-500/20">
        pending-review
      </Badge>
    );
  }
  if (def.review_status === "rejected") {
    return (
      <Badge className="bg-red-500/15 text-red-700 border-red-500/30 hover:bg-red-500/20">
        rejected
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      draft
    </Badge>
  );
}

// ── side-by-side diff ─────────────────────────────────────────────────────

function JsonDiffView({
  label,
  value,
  className,
}: {
  label: string;
  value: Record<string, unknown> | null;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground px-1">
        {label}
      </p>
      <pre className="text-xs bg-muted rounded-md p-3 overflow-auto max-h-96 font-mono leading-relaxed">
        {value ? (
          JSON.stringify(value, null, 2)
        ) : (
          <span className="italic text-muted-foreground">— none —</span>
        )}
      </pre>
    </div>
  );
}

// ── submit-for-review dialog ──────────────────────────────────────────────

interface SubmitDialogProps {
  def: WorkflowDefinition;
  onClose: () => void;
  onSubmit: (id: string) => void;
  isMutating: boolean;
}

function SubmitDialog({ def, onClose, onSubmit, isMutating }: SubmitDialogProps) {
  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCode className="h-5 w-5" />
            {def.name}
            <span className="text-muted-foreground font-normal text-sm">v{def.version}</span>
          </DialogTitle>
          <DialogDescription>
            Review the definition before submitting it for approval.
          </DialogDescription>
        </DialogHeader>

        <JsonDiffView label="Definition" value={def.definition} />

        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onClose} disabled={isMutating}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(def.id)} disabled={isMutating}>
            Submit for Review
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── approve / reject dialog ───────────────────────────────────────────────

interface ReviewDialogProps {
  pending: WorkflowDefinition;
  liveVersion: WorkflowDefinition | null;
  onClose: () => void;
  onApprove: (id: string, reason: string) => void;
  onReject: (id: string, reason: string) => void;
  isMutating: boolean;
  auditEntries: AuditEntry[];
}

function ReviewDialog({
  pending,
  liveVersion,
  onClose,
  onApprove,
  onReject,
  isMutating,
  auditEntries,
}: ReviewDialogProps) {
  const [reason, setReason] = useState("");
  const { canReview } = useAuthCapabilities();

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-4xl w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCode className="h-5 w-5" />
            {pending.name}
            <span className="text-muted-foreground font-normal text-sm">v{pending.version}</span>
          </DialogTitle>
          <DialogDescription>
            Review the pending definition against the current live version.
          </DialogDescription>
        </DialogHeader>

        {/* Diff */}
        <div className="grid grid-cols-2 gap-4 mt-2">
          <JsonDiffView label="Current live" value={liveVersion?.definition ?? null} />
          <JsonDiffView label="Pending (staging)" value={pending.definition} />
        </div>

        {/* Reason */}
        {canReview && (
          <div className="flex flex-col gap-1.5 mt-2">
            <label className="text-sm font-medium" htmlFor="review-reason">
              Reason (optional)
            </label>
            <Textarea
              id="review-reason"
              placeholder="Describe why you are approving or rejecting…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>
        )}

        {/* Actions */}
        {canReview && (
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="outline"
              onClick={() => onReject(pending.id, reason)}
              disabled={isMutating}
              className="text-red-600 border-red-300 hover:bg-red-50 hover:text-red-700"
            >
              <XCircle className="h-4 w-4" />
              Reject
            </Button>
            <Button
              onClick={() => onApprove(pending.id, reason)}
              disabled={isMutating}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <CheckCircle className="h-4 w-4" />
              Approve
            </Button>
          </div>
        )}

        {/* Audit history */}
        {auditEntries.length > 0 && (
          <div className="mt-4 border-t pt-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              Audit history
            </p>
            <ul className="space-y-1.5 max-h-32 overflow-y-auto">
              {auditEntries.map((entry) => (
                <li key={entry.id} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="shrink-0 font-medium text-foreground/70">{entry.action}</span>
                  <span className="shrink-0">by {entry.actor_id}</span>
                  {entry.reason && <span className="italic truncate">— {entry.reason}</span>}
                  <span className="ml-auto shrink-0">
                    {new Date(entry.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── definition row ────────────────────────────────────────────────────────

function DefinitionRow({ def, onClick }: { def: WorkflowDefinition; onClick: () => void }) {
  const isPending = def.review_status === "pending-review";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left flex items-center gap-4 px-4 py-3 rounded-lg border transition-colors",
        isPending
          ? "border-yellow-300 bg-yellow-50/50 hover:bg-yellow-50 dark:bg-yellow-900/10 dark:border-yellow-700 cursor-pointer"
          : "border-border hover:bg-muted/40 cursor-pointer"
      )}
    >
      <FileCode className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{def.name}</p>
        <p className="text-xs text-muted-foreground">
          v{def.version}
          {def.description ? ` · ${def.description}` : ""}
        </p>
      </div>
      <StatusBadge def={def} />
      {isPending && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
    </button>
  );
}

// ── main page ─────────────────────────────────────────────────────────────

export function WorkflowDefinitionsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<WorkflowDefinition | null>(null);
  const [submittingDef, setSubmittingDef] = useState<WorkflowDefinition | null>(null);

  // Require an authenticated profile before allowing mutations.
  // The whole app is wrapped in AuthGate so this should never be null in practice.
  const userId = profile?.id;

  const {
    data: definitions = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["workflow-definitions"],
    queryFn: fetchDefinitions,
  });

  const { data: auditEntries = [] } = useQuery({
    queryKey: ["workflow-definition-audit", selected?.id],
    queryFn: () => fetchAuditLog(selected?.id ?? ""),
    enabled: !!selected,
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      if (!userId) throw new Error("You must be signed in to approve definitions");
      const { data, error } = await supabase.rpc("approve_workflow_definition", {
        p_id: id,
        p_reason: reason || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow-definitions"] });
      queryClient.invalidateQueries({ queryKey: ["workflow-definition-audit"] });
      setSelected(null);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      if (!userId) throw new Error("You must be signed in to reject definitions");
      const { data, error } = await supabase.rpc("reject_workflow_definition", {
        p_id: id,
        p_reason: reason || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow-definitions"] });
      queryClient.invalidateQueries({ queryKey: ["workflow-definition-audit"] });
      setSelected(null);
    },
  });

  // Submit-for-review mutation — opens SubmitDialog for explicit confirmation.
  const submitMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!userId) throw new Error("You must be signed in to submit definitions for review");
      const { data, error } = await supabase.rpc("submit_definition_for_review", {
        p_id: id,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow-definitions"] });
      setSubmittingDef(null);
    },
  });

  // Group definitions by name for finding the live counterpart
  const liveByName = definitions.reduce<Record<string, WorkflowDefinition>>((acc, d) => {
    if (d.is_active) acc[d.name] = d;
    return acc;
  }, {});

  const pendingCount = definitions.filter((d) => d.review_status === "pending-review").length;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workflow Definitions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Promote staging definitions to production with an approval gate.
          </p>
        </div>
        {pendingCount > 0 && (
          <Badge className="bg-yellow-500/15 text-yellow-700 border-yellow-500/30 flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            {pendingCount} pending
          </Badge>
        )}
      </div>

      {/* Error state */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-4 text-sm text-destructive">
            Failed to load definitions: {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-14 rounded-lg border bg-muted/40 animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && definitions.length === 0 && (
        <Card>
          <CardContent className="pt-8 pb-8 text-center text-muted-foreground text-sm">
            No workflow definitions found. Definitions are created by the Temporal worker or via the
            deploy_workflow_definition() database function.
          </CardContent>
        </Card>
      )}

      {/* Pending-review section */}
      {definitions.some((d) => d.review_status === "pending-review") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-yellow-600" />
              Pending Review
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {definitions
              .filter((d) => d.review_status === "pending-review")
              .map((def) => (
                <DefinitionRow key={def.id} def={def} onClick={() => setSelected(def)} />
              ))}
          </CardContent>
        </Card>
      )}

      {/* Live definitions */}
      {definitions.some((d) => d.is_active) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              Live
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {definitions
              .filter((d) => d.is_active)
              .map((def) => (
                <DefinitionRow key={def.id} def={def} onClick={() => setSelected(def)} />
              ))}
          </CardContent>
        </Card>
      )}

      {/* Draft & rejected definitions */}
      {definitions.some((d) => !d.is_active && d.review_status !== "pending-review") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Other Versions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {definitions
              .filter((d) => !d.is_active && d.review_status !== "pending-review")
              .map((def) => (
                <DefinitionRow key={def.id} def={def} onClick={() => setSubmittingDef(def)} />
              ))}
          </CardContent>
        </Card>
      )}

      {/* Submit-for-review dialog (for draft / rejected definitions) */}
      {submittingDef && (
        <SubmitDialog
          def={submittingDef}
          onClose={() => setSubmittingDef(null)}
          onSubmit={(id) => submitMutation.mutate(id)}
          isMutating={submitMutation.isPending}
        />
      )}

      {/* Review dialog (for pending-review definitions) */}
      {selected && (
        <ReviewDialog
          pending={selected}
          liveVersion={liveByName[selected.name] ?? null}
          onClose={() => setSelected(null)}
          onApprove={(id, reason) => approveMutation.mutate({ id, reason })}
          onReject={(id, reason) => rejectMutation.mutate({ id, reason })}
          isMutating={approveMutation.isPending || rejectMutation.isPending}
          auditEntries={auditEntries}
        />
      )}

      {/* Mutation error toasts */}
      {(approveMutation.error || rejectMutation.error || submitMutation.error) && (
        <div className="fixed bottom-4 right-4 bg-destructive text-destructive-foreground rounded-lg px-4 py-3 text-sm shadow-lg max-w-sm">
          {
            ((approveMutation.error ?? rejectMutation.error ?? submitMutation.error) as Error)
              .message
          }
        </div>
      )}
    </div>
  );
}
