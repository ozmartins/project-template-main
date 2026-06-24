/**
 * Root Route - App Shell
 */

import { createRootRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";
import {
  Building2,
  ClipboardCheck,
  FileCode,
  FileQuestion,
  FileText,
  FolderOpen,
  GitBranch,
  History,
  Layers,
  LayoutDashboard,
  Play,
  UserCircle,
  UsersRound,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createRootRoute({
  component: RootComponent,
});

export function isWorkflowHistoryPath(pathname: string) {
  const [routePrefix, routeName, ...routeRest] = pathname.split("/").filter(Boolean);

  if (routePrefix !== "workflows") {
    return false;
  }

  if (routeName === "history") {
    return true;
  }

  if (routeName === "definitions") {
    return false;
  }

  if (routeName === "executions") {
    return routeRest.length === 1;
  }

  if (!routeName) {
    return false;
  }

  return routeRest.length === 0;
}

function RootComponent() {
  return (
    <div className="min-h-screen flex bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-h-screen">
        <Header />
        <main className="flex-1 p-8 overflow-auto">
          <Outlet />
        </main>
      </div>
      {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-right" />}
    </div>
  );
}

function Header() {
  return (
    <header className="h-14 border-b bg-card/80 backdrop-blur-sm flex items-center px-8 gap-4 shrink-0 sticky top-0 z-10">
      <div className="flex-1" />
      <span className="text-xs text-muted-foreground border border-border rounded-full px-3 py-1 hidden sm:inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
        Supabase connected
      </span>
    </header>
  );
}

function NavLink({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  const location = useLocation();
  // Split pathname into segments to avoid prefix-collision between entity types
  // e.g. "group" must not activate when on "/entities/groups"
  const [, routePrefix, routeEntityType] = location.pathname.split("/");
  const isActive = routePrefix === "entities" && routeEntityType === to;

  return (
    <Link
      to="/entities/$entityType"
      params={{ entityType: to }}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150",
        isActive
          ? "bg-[--color-sidebar-active-bg] text-[--color-sidebar-active-fg] shadow-sm"
          : "text-[--color-sidebar-foreground] hover:bg-[--color-sidebar-hover-bg] hover:text-white"
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 transition-colors",
          isActive ? "text-white/90" : "text-[--color-sidebar-foreground] group-hover:text-white/80"
        )}
      />
      {label}
    </Link>
  );
}

function WorkflowNavLink({
  to,
  isActive,
  icon: Icon,
  label,
}: {
  to: string;
  isActive: (pathname: string) => boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  const location = useLocation();
  const active = isActive(location.pathname);

  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150",
        active
          ? "bg-[--color-sidebar-active-bg] text-[--color-sidebar-active-fg] shadow-sm"
          : "text-[--color-sidebar-foreground] hover:bg-[--color-sidebar-hover-bg] hover:text-white"
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 transition-colors",
          active ? "text-white/90" : "text-[--color-sidebar-foreground] group-hover:text-white/80"
        )}
      />
      {label}
    </Link>
  );
}

function Sidebar() {
  const location = useLocation();
  const isDashboard = location.pathname === "/";
  const isWorkflows =
    location.pathname === "/workflows" || location.pathname.startsWith("/workflows/");
  const isWorkflowHistory = isWorkflowHistoryPath(location.pathname);

  return (
    <aside
      className="w-64 shrink-0 flex flex-col min-h-screen sticky top-0"
      style={{ background: "var(--color-sidebar)" }}
    >
      {/* Logo / Brand */}
      <div className="h-14 flex items-center gap-3 px-5 border-b border-[--color-sidebar-border] shrink-0">
        <div
          className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "var(--color-primary)" }}
        >
          <Layers className="h-4 w-4 text-white" />
        </div>
        <span
          className="text-sm font-semibold tracking-tight"
          style={{ color: "var(--color-sidebar-logo-fg)" }}
        >
          JSON UI Engine
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {/* Dashboard link */}
        <Link
          to="/"
          className={cn(
            "group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150",
            isDashboard
              ? "bg-[--color-sidebar-active-bg] text-[--color-sidebar-active-fg] shadow-sm"
              : "text-[--color-sidebar-foreground] hover:bg-[--color-sidebar-hover-bg] hover:text-white"
          )}
        >
          <LayoutDashboard
            className={cn(
              "h-4 w-4 shrink-0",
              isDashboard
                ? "text-white/90"
                : "text-[--color-sidebar-foreground] group-hover:text-white/80"
            )}
          />
          Dashboard
        </Link>

        <Link
          to="/workflows"
          className={cn(
            "group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150",
            isWorkflows
              ? "bg-[--color-sidebar-active-bg] text-[--color-sidebar-active-fg] shadow-sm"
              : "text-[--color-sidebar-foreground] hover:bg-[--color-sidebar-hover-bg] hover:text-white"
          )}
        >
          <GitBranch
            className={cn(
              "h-4 w-4 shrink-0",
              isWorkflows
                ? "text-white/90"
                : "text-[--color-sidebar-foreground] group-hover:text-white/80"
            )}
          />
          Workflows
        </Link>

        {/* Entities section */}
        <div className="pt-5 pb-1">
          <p
            className="px-3 text-[10px] font-semibold uppercase tracking-widest mb-1"
            style={{ color: "var(--color-sidebar-section)" }}
          >
            Entities
          </p>
        </div>
        <NavLink to="portfolio" icon={FolderOpen} label="Portfolios" />
        <NavLink to="group" icon={UsersRound} label="Groups" />
        <NavLink to="vbu" icon={Building2} label="VBUs" />
        <NavLink to="assessment" icon={ClipboardCheck} label="Assessments" />
        <NavLink to="question" icon={FileQuestion} label="Questions" />
        <NavLink to="person" icon={UserCircle} label="People" />
        <NavLink to="evidence" icon={FileText} label="Evidence" />

        {/* Workflows section */}
        <div className="pt-5 pb-1">
          <p
            className="px-3 text-[10px] font-semibold uppercase tracking-widest mb-1"
            style={{ color: "var(--color-sidebar-section)" }}
          >
            Workflows
          </p>
        </div>
        <WorkflowNavLink
          to="/workflows/definitions/"
          isActive={(pathname) => pathname.startsWith("/workflows/definitions")}
          icon={FileCode}
          label="Definitions"
        />
        <WorkflowNavLink
          to="/workflows/trigger"
          isActive={(pathname) => pathname.startsWith("/workflows/trigger")}
          icon={Play}
          label="Trigger workflow"
        />
        <Link
          to="/workflows/history"
          aria-current={isWorkflowHistory ? "page" : undefined}
          className={cn(
            "group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150",
            isWorkflowHistory
              ? "bg-[--color-sidebar-active-bg] text-[--color-sidebar-active-fg] shadow-sm"
              : "text-[--color-sidebar-foreground] hover:bg-[--color-sidebar-hover-bg] hover:text-white"
          )}
        >
          <History
            className={cn(
              "h-4 w-4 shrink-0",
              isWorkflowHistory
                ? "text-white/90"
                : "text-[--color-sidebar-foreground] group-hover:text-white/80"
            )}
          />
          Workflow history
        </Link>
      </nav>
    </aside>
  );
}
