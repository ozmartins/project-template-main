/**
 * Index Route - Dashboard
 */

import { createFileRoute } from "@tanstack/react-router";
import { UIEngine } from "@/engine";
import type { PageDefinition } from "@/engine/types";
import dashboardPage from "@/pages/dashboard.json";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

function DashboardPage() {
  return <UIEngine page={dashboardPage as PageDefinition} />;
}
