import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import labelColors from "@/constants/label-colors";
import { resolveLabelColor } from "@/lib/label-color";
import { cn } from "@/lib/utils";

/** A small color-dot button that opens the shared label palette (see
 * constants/label-colors.ts) to assign a color to one dropdown option.
 * Reused for the create form and the inline edit form (uncommitted colors) and
 * the field rows (persisted immediately via onSelect). */
export default function OptionColorSwatch({
  color,
  ariaLabel,
  onSelect,
}: {
  color: string | undefined;
  ariaLabel: string;
  onSelect: (colorValue: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "size-3.5 shrink-0 rounded-full border transition-transform hover:scale-110",
            color
              ? "border-transparent"
              : "border-dashed border-muted-foreground/50",
          )}
          style={
            color ? { backgroundColor: resolveLabelColor(color) } : undefined
          }
        />
      </PopoverTrigger>
      <PopoverContent className="w-40" align="start">
        <div className="flex flex-wrap gap-1.5 p-1">
          {labelColors.map((c) => (
            <button
              key={c.value}
              type="button"
              title={c.label}
              aria-label={c.label}
              className={cn(
                "size-6 rounded-full border-2 transition-[scale,border-color]",
                color === c.value
                  ? "border-foreground scale-110"
                  : "border-transparent hover:scale-110",
              )}
              style={{ backgroundColor: c.color }}
              onClick={() => onSelect(c.value)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
