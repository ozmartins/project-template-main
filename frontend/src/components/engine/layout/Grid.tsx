/**
 * Grid Component - CSS Grid layout with configurable columns and gaps
 */

import type { EngineComponentProps } from "@/engine/types";
import { cn } from "@/lib/utils";

interface GridProps extends EngineComponentProps {
  columns?: number | string;
  rows?: number | string;
  gap?: number | string;
  columnGap?: number | string;
  rowGap?: number | string;
  className?: string;
}

export function Grid({
  columns = 1,
  rows,
  gap = 4,
  columnGap,
  rowGap,
  className,
  children,
}: GridProps) {
  const gridCols = typeof columns === "number" ? `grid-cols-${columns}` : "";
  const gapClass = typeof gap === "number" ? `gap-${gap}` : "";

  const style: React.CSSProperties = {};

  if (typeof columns === "string") {
    style.gridTemplateColumns = columns;
  }

  if (typeof rows === "string") {
    style.gridTemplateRows = rows;
  } else if (typeof rows === "number") {
    style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  }

  if (typeof gap === "string") {
    style.gap = gap;
  }

  if (columnGap !== undefined) {
    style.columnGap = typeof columnGap === "number" ? `${columnGap * 0.25}rem` : columnGap;
  }

  if (rowGap !== undefined) {
    style.rowGap = typeof rowGap === "number" ? `${rowGap * 0.25}rem` : rowGap;
  }

  return (
    <div
      className={cn("grid", gridCols, gapClass, className)}
      style={Object.keys(style).length > 0 ? style : undefined}
    >
      {children}
    </div>
  );
}
