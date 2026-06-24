import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkflowGraph } from "@/components/WorkflowGraph";
import { getWorkflowDefinition, listWorkflowDefinitions } from "@/data/workflowDefinitions";

export const Route = createFileRoute("/workflows/definitions/$name")({
  component: WorkflowDefinitionRoute,
});

export function WorkflowDefinitionRoute() {
  const { name } = Route.useParams();
  const definition = getWorkflowDefinition(name);

  if (!definition) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Workflow definition not found</CardTitle>
          <CardDescription>
            No definition named <strong>{name}</strong> exists. Available definitions:{" "}
            {listWorkflowDefinitions().join(", ")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/workflows/definitions">Back to definitions catalog</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{definition.name}</CardTitle>
          <CardDescription>
            Version {definition.version}
            {definition.description ? ` — ${definition.description}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Definition-only mode renders the workflow structure without execution status overlays.
          </p>
        </CardContent>
      </Card>
      <WorkflowGraph definition={definition} />
    </div>
  );
}
