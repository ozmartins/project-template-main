/**
 * Entity List Route
 */

import { createFileRoute } from "@tanstack/react-router";
import { UIEngine } from "@/engine";
import type { PageDefinition } from "@/engine/types";
import entityListPage from "@/pages/entity-list.json";

export const Route = createFileRoute("/entities/$entityType/")({
  component: EntityListPage,
});

function EntityListPage() {
  const { entityType } = Route.useParams();
  return <UIEngine page={entityListPage as PageDefinition} params={{ entityType }} />;
}
