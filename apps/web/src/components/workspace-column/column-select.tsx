import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ColumnSelectProps = {
  id?: string;
  columns: Array<{ id: string; name: string }>;
  value: string | undefined;
  onChange: (columnId: string) => void;
  ariaLabel?: string;
  disabled?: boolean;
};

/** Picks one workspace column (the fallback or the target of moved tasks). */
export default function ColumnSelect({
  id,
  columns,
  value,
  onChange,
  ariaLabel,
  disabled,
}: ColumnSelectProps) {
  const selected = columns.find((column) => column.id === value);

  return (
    <Select
      id={id}
      value={value ?? null}
      disabled={disabled}
      onValueChange={(next) => {
        if (typeof next === "string" && columns.some((c) => c.id === next)) {
          onChange(next);
        }
      }}
    >
      <SelectTrigger aria-label={ariaLabel}>
        <SelectValue>{selected?.name}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {columns.map((column) => (
          <SelectItem key={column.id} value={column.id}>
            {column.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
