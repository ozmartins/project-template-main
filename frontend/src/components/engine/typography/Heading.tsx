/**
 * Heading Component - h1-h6 headings
 */

import type { EngineComponentProps } from "@/engine/types";
import { cn } from "@/lib/utils";

interface HeadingProps extends EngineComponentProps {
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl";
  className?: string;
}

const defaultSizeByLevel: Record<number, string> = {
  1: "text-4xl font-bold tracking-tight",
  2: "text-3xl font-semibold tracking-tight",
  3: "text-2xl font-semibold",
  4: "text-xl font-semibold",
  5: "text-lg font-medium",
  6: "text-base font-medium",
};

const sizeMap: Record<string, string> = {
  sm: "text-sm font-medium",
  md: "text-base font-medium",
  lg: "text-lg font-semibold",
  xl: "text-xl font-semibold",
  "2xl": "text-2xl font-semibold",
  "3xl": "text-3xl font-semibold tracking-tight",
  "4xl": "text-4xl font-bold tracking-tight",
};

export function Heading({ level = 1, size, className, children }: HeadingProps) {
  const Component = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  const sizeClass = size ? sizeMap[size] : defaultSizeByLevel[level];

  return <Component className={cn(sizeClass, className)}>{children}</Component>;
}
