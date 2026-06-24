/**
 * Checkbox Component - Boolean toggle with label
 */

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { ActionDefinition, EngineComponentProps } from "@/engine/types";
import { useUIEngine } from "@/engine/UIEngineContext";
import { cn } from "@/lib/utils";

interface EngineCheckboxProps extends EngineComponentProps {
  checked?: boolean;
  onChange?: ActionDefinition;
  label?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
}

export function EngineCheckbox({
  checked = false,
  onChange,
  label,
  name,
  disabled = false,
  className,
}: EngineCheckboxProps) {
  const { dispatch } = useUIEngine();

  const handleChange = (newChecked: boolean) => {
    if (onChange) {
      dispatch(onChange, { event: { target: { checked: newChecked, value: newChecked } } });
    }
  };

  const checkboxId = name || `checkbox-${Math.random().toString(36).slice(2, 9)}`;

  return (
    <div className={cn("flex items-center space-x-2", className)}>
      <Checkbox
        id={checkboxId}
        checked={checked}
        onCheckedChange={handleChange}
        disabled={disabled}
      />
      {label && (
        <Label
          htmlFor={checkboxId}
          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
        >
          {label}
        </Label>
      )}
    </div>
  );
}
