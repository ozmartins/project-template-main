/**
 * Skeleton Component - Loading placeholder
 */

import { Skeleton } from "@/components/ui/skeleton";
import type { EngineComponentProps } from "@/engine/types";
import { cn } from "@/lib/utils";

interface EngineSkeletonProps extends EngineComponentProps {
  width?: string | number;
  height?: string | number;
  variant?: "text" | "circular" | "rectangular";
  className?: string;
}

export function EngineSkeleton({
  width,
  height,
  variant = "rectangular",
  className,
}: EngineSkeletonProps) {
  const style: React.CSSProperties = {};

  if (width) {
    style.width = typeof width === "number" ? `${width}px` : width;
  }

  if (height) {
    style.height = typeof height === "number" ? `${height}px` : height;
  }

  return (
    <Skeleton
      className={cn(
        variant === "circular" && "rounded-full",
        variant === "text" && "h-4 w-full",
        className
      )}
      style={style}
    />
  );
}
