import { Meter, MeterIndicator, MeterTrack } from "@/components/ui/meter";
import { cn } from "@/lib/cn";

// Thresholds of the capacity engine (apps/api/src/infrastructure/capacity.ts):
// a resource is "near full" from 80 percent and "over capacity" above 100.
export function usageTone(percent: number | null) {
  if (percent == null) return "none" as const;
  if (percent > 100) return "over" as const;
  if (percent >= 80) return "high" as const;
  return "ok" as const;
}

const FILL = {
  none: "bg-muted-foreground/30",
  ok: "bg-success",
  high: "bg-warning",
  over: "bg-destructive",
} as const;

const TEXT = {
  none: "text-muted-foreground",
  ok: "text-foreground",
  high: "text-warning-foreground",
  over: "text-destructive-foreground",
} as const;

type UsageBarProps = {
  // Use in percent of capacity; null when there is no capacity or no use yet.
  // The bar is capped at 100 percent; the number shows the real value.
  percent: number | null;
  // Accessible name, e.g. "RAM use of ADVANCE-2 256 GB GRA #1".
  label: string;
  className?: string;
};

export function UsageBar({ percent, label, className }: UsageBarProps) {
  const tone = usageTone(percent);
  const width = percent == null ? 0 : Math.min(Math.max(percent, 0), 100);
  return (
    <div className={cn("flex min-w-28 items-center gap-2", className)}>
      <Meter
        aria-label={label}
        className="flex-1"
        max={100}
        min={0}
        value={width}
      >
        <MeterTrack className="h-1.5 rounded-full bg-muted">
          <MeterIndicator className={cn("rounded-full", FILL[tone])} />
        </MeterTrack>
      </Meter>
      <span className={cn("w-12 text-right text-xs tabular-nums", TEXT[tone])}>
        {percent == null ? "–" : `${Math.round(percent)}%`}
      </span>
    </div>
  );
}
