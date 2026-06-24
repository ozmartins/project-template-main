/**
 * Text Component - Typography for paragraphs and spans
 */

import type { EngineComponentProps } from "@/engine/types";
import { cn } from "@/lib/utils";

interface TextProps extends EngineComponentProps {
  variant?: "default" | "muted" | "primary" | "destructive";
  size?: "xs" | "sm" | "base" | "lg" | "xl";
  weight?: "normal" | "medium" | "semibold" | "bold";
  format?: "date" | "datetime" | "relative";
  as?: "p" | "span" | "div";
  className?: string;
}

const variantMap: Record<string, string> = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  primary: "text-primary",
  destructive: "text-destructive",
};

const sizeMap: Record<string, string> = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
  xl: "text-xl",
};

const weightMap: Record<string, string> = {
  normal: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
  bold: "font-bold",
};

function formatTimestamp(value: unknown, format: "date" | "datetime" | "relative"): string {
  if (value === null || value === undefined || value === "") return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "(invalid date)";

  if (format === "relative") {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    // Handle future dates
    if (diffMs < 0) return "in the future";
    const diffSecs = Math.floor(diffMs / 1000);
    if (diffSecs < 60) return "just now";
    const diffMins = Math.floor(diffSecs / 60);
    if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? "" : "s"} ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 28) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
    // Calendar-accurate month/year difference
    const totalMonths =
      (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
    // totalMonths can be 0 when the date is in the same calendar month but >= 28 days ago
    if (totalMonths === 0) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
    if (totalMonths < 12) return `${totalMonths} month${totalMonths === 1 ? "" : "s"} ago`;
    const totalYears = Math.floor(totalMonths / 12);
    return `${totalYears} year${totalYears === 1 ? "" : "s"} ago`;
  }

  if (format === "date") {
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  // datetime
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function Text({
  variant = "default",
  size = "base",
  weight = "normal",
  format,
  as: Component = "p",
  className,
  children,
}: TextProps) {
  const rendered = format ? formatTimestamp(children, format) : children;
  return (
    <Component className={cn(variantMap[variant], sizeMap[size], weightMap[weight], className)}>
      {rendered}
    </Component>
  );
}
