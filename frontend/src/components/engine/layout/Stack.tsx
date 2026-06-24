/**
 * Stack Component - Flexbox layout with configurable direction and spacing
 */

import type { CSSProperties, HTMLAttributes } from "react";
import type { EngineComponentProps } from "@/engine/types";
import { cn } from "@/lib/utils";

interface StackProps
  extends EngineComponentProps,
    Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  direction?: "vertical" | "horizontal";
  spacing?: number | string;
  align?: "start" | "center" | "end" | "stretch" | "baseline";
  justify?: "start" | "center" | "end" | "between" | "around" | "evenly";
  wrap?: boolean;
  className?: string;
}

const alignMap: Record<string, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
  baseline: "items-baseline",
};

const justifyMap: Record<string, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
  around: "justify-around",
  evenly: "justify-evenly",
};

export function Stack({
  direction = "vertical",
  spacing = 4,
  align = "stretch",
  justify = "start",
  wrap = false,
  className,
  children,
  style,
  ...domProps
}: StackProps) {
  const isHorizontal = direction === "horizontal";
  const gapClass = typeof spacing === "number" ? `gap-${spacing}` : "";
  const gapStyle = typeof spacing === "string" ? { gap: spacing } : undefined;
  const combinedStyle: CSSProperties | undefined = gapStyle ? { ...gapStyle, ...style } : style;

  return (
    <div
      {...domProps}
      className={cn(
        "flex",
        isHorizontal ? "flex-row" : "flex-col",
        gapClass,
        alignMap[align],
        justifyMap[justify],
        wrap && "flex-wrap",
        className
      )}
      style={combinedStyle}
    >
      {children}
    </div>
  );
}
