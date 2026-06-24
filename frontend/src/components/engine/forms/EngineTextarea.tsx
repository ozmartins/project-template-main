/**
 * Textarea Component - Multi-line text input
 */

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionDefinition, EngineComponentProps } from "@/engine/types";
import { useUIEngine } from "@/engine/UIEngineContext";
import { cn } from "@/lib/utils";

interface EngineTextareaProps extends EngineComponentProps {
  value?: string;
  onChange?: ActionDefinition;
  onBlur?: ActionDefinition;
  placeholder?: string;
  label?: string;
  name?: string;
  rows?: number;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  className?: string;
}

export function EngineTextarea({
  value = "",
  onChange,
  onBlur,
  placeholder,
  label,
  name,
  rows = 3,
  disabled = false,
  required = false,
  error,
  className,
}: EngineTextareaProps) {
  const { dispatch } = useUIEngine();

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (onChange) {
      dispatch(onChange, { event: e });
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    if (onBlur) {
      dispatch(onBlur, { event: e });
    }
  };

  const textareaId = name || `textarea-${Math.random().toString(36).slice(2, 9)}`;

  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <Label htmlFor={textareaId}>
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </Label>
      )}
      <Textarea
        id={textareaId}
        name={name}
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        required={required}
        className={cn(error && "border-destructive")}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
