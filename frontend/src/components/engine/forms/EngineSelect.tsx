/**
 * Select Component - Dropdown select with label support
 */

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ActionDefinition, EngineComponentProps } from "@/engine/types";
import { useUIEngine } from "@/engine/UIEngineContext";
import { cn } from "@/lib/utils";

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface EngineSelectProps extends EngineComponentProps {
  value?: string;
  onChange?: ActionDefinition;
  options?: SelectOption[];
  placeholder?: string;
  label?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  className?: string;
}

export function EngineSelect({
  value,
  onChange,
  options = [],
  placeholder = "Select...",
  label,
  name,
  disabled = false,
  required = false,
  error,
  className,
}: EngineSelectProps) {
  const { dispatch } = useUIEngine();

  const handleChange = (newValue: string) => {
    if (onChange) {
      dispatch(onChange, { event: { target: { value: newValue } } });
    }
  };

  const selectId = name || `select-${Math.random().toString(36).slice(2, 9)}`;

  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <Label htmlFor={selectId}>
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </Label>
      )}
      <Select value={value} onValueChange={handleChange} disabled={disabled}>
        <SelectTrigger id={selectId} className={cn(error && "border-destructive")}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
