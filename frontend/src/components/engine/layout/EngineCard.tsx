/**
 * Card Component - Content container with optional title and description
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { EngineComponentProps } from "@/engine/types";
import { cn } from "@/lib/utils";

interface EngineCardProps extends EngineComponentProps {
  title?: string;
  description?: string;
  footer?: React.ReactNode;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  footerClassName?: string;
}

export function EngineCard({
  title,
  description,
  footer,
  className,
  headerClassName,
  contentClassName,
  footerClassName,
  children,
}: EngineCardProps) {
  const hasHeader = title || description;

  return (
    <Card className={cn(className)}>
      {hasHeader && (
        <CardHeader className={cn(headerClassName)}>
          {title && <CardTitle>{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent className={cn(!hasHeader && "pt-6", contentClassName)}>{children}</CardContent>
      {footer && <CardFooter className={cn(footerClassName)}>{footer}</CardFooter>}
    </Card>
  );
}
