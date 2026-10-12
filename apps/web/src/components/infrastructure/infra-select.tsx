import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type InfraSelectOption = { value: string; label: string };

// A Select over a plain list. A current value that is not in the list stays
// visible (as its raw value) instead of turning into the placeholder.
export function InfraSelect({
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
  disabled,
  invalid,
  className,
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  options: InfraSelectOption[];
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  const known = options.some((option) => option.value === value);
  const all = value && !known ? [...options, { value, label: value }] : options;
  const current = all.find((option) => option.value === value);

  return (
    <Select
      value={value || null}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next);
      }}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        className={className}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
      >
        <SelectValue placeholder={placeholder}>{current?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {all.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
