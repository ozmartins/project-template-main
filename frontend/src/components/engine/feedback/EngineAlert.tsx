/**
 * Alert Component - Alert messages
 */

import { AlertCircle, AlertTriangle, CheckCircle, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { EngineComponentProps } from "@/engine/types";
import { cn } from "@/lib/utils";

interface EngineAlertProps extends EngineComponentProps {
  variant?: "default" | "destructive" | "success" | "warning" | "info";
  title?: string;
  description?: string;
  className?: string;
}

const iconMap = {
  default: Info,
  destructive: AlertCircle,
  success: CheckCircle,
  warning: AlertTriangle,
  info: Info,
};

export function EngineAlert({
  variant = "default",
  title,
  description,
  className,
  children,
}: EngineAlertProps) {
  const Icon = iconMap[variant];
  // Map success/warning/info to default for shadcn, but keep the icon
  const shadcnVariant = variant === "destructive" ? "destructive" : "default";

  return (
    <Alert variant={shadcnVariant} className={cn(className)}>
      <Icon className="h-4 w-4" />
      {title && <AlertTitle>{title}</AlertTitle>}
      {description && <AlertDescription>{description}</AlertDescription>}
      {children}
    </Alert>
  );
}
