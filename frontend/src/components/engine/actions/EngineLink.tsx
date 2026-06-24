/**
 * Link Component - Navigation link
 */

import { Link } from "@tanstack/react-router";
import type { EngineComponentProps } from "@/engine/types";
import { cn } from "@/lib/utils";

interface EngineLinkProps extends EngineComponentProps {
  to?: string;
  external?: boolean;
  className?: string;
}

export function EngineLink({ to, external = false, className, children }: EngineLinkProps) {
  const linkClasses = cn("text-primary underline-offset-4 hover:underline", className);

  if (!to) {
    return <span className={linkClasses}>{children}</span>;
  }

  if (external) {
    return (
      <a href={to} target="_blank" rel="noopener noreferrer" className={linkClasses}>
        {children}
      </a>
    );
  }

  return (
    <Link to={to} className={linkClasses}>
      {children}
    </Link>
  );
}
