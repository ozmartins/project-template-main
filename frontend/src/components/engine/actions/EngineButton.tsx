/**
 * Button Component - Clickable button with action support
 */

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionDefinition, EngineComponentProps } from "@/engine/types";
import { useUIEngine } from "@/engine/UIEngineContext";
import { cn } from "@/lib/utils";

interface EngineButtonProps extends EngineComponentProps {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  onClick?: ActionDefinition;
  disabled?: boolean;
  loading?: boolean;
  type?: "button" | "submit" | "reset";
  className?: string;
}

export function EngineButton({
  variant = "default",
  size = "default",
  onClick,
  disabled = false,
  loading = false,
  type = "button",
  className,
  children,
}: EngineButtonProps) {
  const { dispatch } = useUIEngine();

  const handleClick = async () => {
    if (onClick && !disabled && !loading) {
      await dispatch(onClick);
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      type={type}
      disabled={disabled || loading}
      onClick={handleClick}
      className={cn(className)}
    >
      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {children}
    </Button>
  );
}
