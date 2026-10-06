import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import {
  ESTIMATE_UNITS,
  type EstimateUnit,
  minutesToUnitValue,
  parseEstimateInput,
} from "@/lib/estimate";

type EstimateEditorProps = {
  /** Committed estimate in minutes (null = none) and the unit it is shown in. */
  minutes: number | null;
  unit: EstimateUnit;
  /**
   * Persists a new value (null clears). A rejection reverts the field to the
   * last committed value; the caller reports the error.
   */
  onSave: (minutes: number | null, unit: EstimateUnit) => Promise<void> | void;
  /** Disables the amount, unit and clear controls, e.g. when both dates are set. */
  disabled?: boolean;
  /** Explains why the editor is disabled; shown only while it is. */
  disabledHint?: string;
  /** Always-visible help text under the field (the estimate/date-range rule). */
  hint?: string;
};

function fieldText(minutes: number | null, unit: EstimateUnit): string {
  return minutes === null ? "" : String(minutesToUnitValue(minutes, unit));
}

// The shared estimate field: a decimal amount in hours or work days (8 h),
// stored as whole minutes, with an hours/days switch and a clear button. An
// empty field clears the estimate. Used by the task details popover (saves on
// commit) and the create-task form (holds the value until submit).
export default function EstimateEditor({
  minutes,
  unit: initialUnit,
  onSave,
  disabled = false,
  disabledHint,
  hint,
}: EstimateEditorProps) {
  const { t } = useTranslation();
  const [unit, setUnit] = useState<EstimateUnit>(initialUnit);
  const [input, setInput] = useState(fieldText(minutes, initialUnit));
  // The last minutes value sent to `onSave` (null = cleared), deduped against
  // instead of the `minutes` prop for the same reason as the progress popover:
  // the prop only catches up after the refetch, so Enter followed by the blur
  // that closing causes would otherwise save twice.
  const lastCommittedRef = useRef<number | null>(minutes);
  // Mirror of the ref for rendering (whether there is something to clear).
  const [hasEstimate, setHasEstimate] = useState(minutes !== null);

  const save = async (next: number | null, nextUnit: EstimateUnit) => {
    const previous = lastCommittedRef.current;
    lastCommittedRef.current = next;
    setHasEstimate(next !== null);
    try {
      await onSave(next, nextUnit);
    } catch {
      lastCommittedRef.current = previous;
      setHasEstimate(previous !== null);
      setInput(fieldText(previous, nextUnit));
    }
  };

  const handleCommit = () => {
    if (disabled) return;
    const parsed = parseEstimateInput(input, unit);
    if (parsed.kind === "invalid") {
      // Revert to the last saved value instead of persisting a guess.
      setInput(fieldText(lastCommittedRef.current, unit));
      return;
    }
    const next = parsed.kind === "empty" ? null : parsed.minutes;
    if (parsed.kind === "value") {
      setInput(String(minutesToUnitValue(parsed.minutes, unit)));
    }
    if (next === lastCommittedRef.current) return;
    void save(next, unit);
  };

  const handleUnitChange = (nextUnit: EstimateUnit) => {
    if (nextUnit === unit || disabled) return;
    // The stored quantity is minutes, so switching the unit re-expresses the
    // same estimate (8 h becomes 1 d) rather than reinterpreting the number.
    const parsed = parseEstimateInput(input, unit);
    const current =
      parsed.kind === "value" ? parsed.minutes : lastCommittedRef.current;
    setUnit(nextUnit);
    setInput(fieldText(current, nextUnit));
    if (current !== null && current === lastCommittedRef.current) {
      void save(current, nextUnit);
    }
  };

  const hintId = "estimate-editor-hint";
  const shownHint = disabled ? disabledHint : hint;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">
          {t("tasks:popover.estimate.label")}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("tasks:popover.estimate.description")}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="text"
          inputMode="decimal"
          size="sm"
          className="w-20 text-right tabular-nums"
          value={input}
          placeholder="0"
          disabled={disabled}
          aria-label={t("tasks:popover.estimate.amountLabel")}
          aria-describedby={shownHint ? hintId : undefined}
          onChange={(e) => setInput(e.target.value)}
          onBlur={handleCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleCommit();
            }
          }}
        />
        <fieldset
          aria-label={t("tasks:popover.estimate.unitLabel")}
          disabled={disabled}
          className={cn(
            "m-0 flex min-w-0 rounded-md border border-input p-0.5",
            disabled && "opacity-50",
          )}
        >
          {ESTIMATE_UNITS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={unit === option}
              className={cn(
                "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                unit === option
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => handleUnitChange(option)}
            >
              {t(`tasks:popover.estimate.units.${option}`)}
            </button>
          ))}
        </fieldset>
      </div>
      {shownHint && (
        <p id={hintId} className="m-0 text-xs text-muted-foreground">
          {shownHint}
        </p>
      )}
      {hasEstimate && !disabled && (
        <Button
          variant="ghost"
          size="xs"
          className="self-start text-muted-foreground"
          onClick={() => {
            setInput("");
            void save(null, unit);
          }}
        >
          {t("tasks:popover.estimate.clear")}
        </Button>
      )}
    </div>
  );
}
