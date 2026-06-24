/**
 * Container Component - Max-width wrapper for content
 */

import type { EngineComponentProps } from "@/engine/types";
import { cn } from "@/lib/utils";

interface ContainerProps extends EngineComponentProps {
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "full" | string;
  padding?: number | string;
  center?: boolean;
  className?: string;
}

const maxWidthMap: Record<string, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  full: "max-w-full",
};

export function Container({
  maxWidth = "2xl",
  padding = 4,
  center = true,
  className,
  children,
}: ContainerProps) {
  const maxWidthClass = maxWidthMap[maxWidth] || "";
  const paddingClass = typeof padding === "number" ? `p-${padding}` : "";

  const style: React.CSSProperties = {};
  if (maxWidth && !maxWidthMap[maxWidth]) {
    style.maxWidth = maxWidth;
  }
  if (typeof padding === "string") {
    style.padding = padding;
  }

  return (
    <div
      className={cn(maxWidthClass, paddingClass, center && "mx-auto", className)}
      style={Object.keys(style).length > 0 ? style : undefined}
    >
      {children}
    </div>
  );
}
