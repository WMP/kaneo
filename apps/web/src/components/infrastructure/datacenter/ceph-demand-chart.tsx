import { TriangleAlert } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { formatDay, formatGb, formatNumber } from "./format";
import type { ClusterCapacity } from "./types";

type Step = ClusterCapacity["result"]["steps"][number];

const FALLBACK_WIDTH = 640;
const HEIGHT = 240;
const MARGIN = { top: 12, right: 68, bottom: 26, left: 60 };
const MARKER_RADIUS = 5;
const TOOLTIP_WIDTH = 224;
const DAY_MS = 86_400_000;
const LABEL_GAP = 14;

const toMs = (date: string) => Date.parse(`${date.slice(0, 10)}T00:00:00Z`);

/** Round ticks from 0 up to a "nice" maximum that covers `max`. */
function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ??
    10 * magnitude;
  const ticks: number[] = [];
  for (let value = 0; value < max + step * 0.999; value += step) {
    ticks.push(value);
    if (value >= max) break;
  }
  return ticks;
}

/** Month starts for long spans, Mondays for short ones, thinned to fit. */
function timeTicks(
  from: number,
  to: number,
  maxCount: number,
): { ms: number; monthly: boolean }[] {
  const monthly = to - from > 120 * DAY_MS;
  const all: number[] = [];
  if (monthly) {
    const start = new Date(from);
    let cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1);
    if (cursor < from) {
      const next = new Date(cursor);
      cursor = Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 1);
    }
    while (cursor <= to) {
      all.push(cursor);
      const next = new Date(cursor);
      cursor = Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 1);
    }
  } else {
    const dayStart = Math.ceil(from / DAY_MS) * DAY_MS;
    // 1970-01-01 was a Thursday, so weekday index 0 (Monday) = (day + 3) % 7.
    const weekday = (Math.floor(dayStart / DAY_MS) + 3) % 7;
    for (
      let cursor = dayStart + ((7 - weekday) % 7) * DAY_MS;
      cursor <= to;
      cursor += 7 * DAY_MS
    ) {
      all.push(cursor);
    }
  }
  const stride = Math.max(1, Math.ceil(all.length / Math.max(1, maxCount)));
  return all.filter((_, i) => i % stride === 0).map((ms) => ({ ms, monthly }));
}

function stepPath(points: { x: number; y: number }[], endX: number) {
  if (points.length === 0) return "";
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += `H${points[i].x}V${points[i].y}`;
  }
  return `${d}H${endX}`;
}

function useContainerWidth() {
  // A callback ref (kept in state) re-attaches the observer when the measured
  // element mounts later, for example after the first VM appears.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  useEffect(() => {
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return { ref: setNode, width };
}

function LegendLine({
  className,
  dashed,
}: {
  className: string;
  dashed?: boolean;
}) {
  return (
    <svg
      width="20"
      height="8"
      viewBox="0 0 20 8"
      className={className}
      aria-hidden="true"
    >
      <line
        x1="0"
        y1="4"
        x2="20"
        y2="4"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray={dashed ? "5 3" : undefined}
      />
    </svg>
  );
}

export function CephDemandChart({
  clusterName,
  region,
  steps,
  usableAllGb,
  today,
}: {
  clusterName: string;
  region: string;
  steps: Step[];
  usableAllGb: number;
  today: string;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n?.language;
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  const hasDemand = steps.some((step) => step.usedCephGb > 0);
  const { ref, width } = useContainerWidth();

  const plotLeft = MARGIN.left;
  const plotRight = Math.max(plotLeft + 40, width - MARGIN.right);
  const plotTop = MARGIN.top;
  const plotBottom = HEIGHT - MARGIN.bottom;

  const geometry = useMemo(() => {
    if (!hasDemand) return null;
    const first = toMs(steps[0].date);
    const last = toMs(steps[steps.length - 1].date);
    const todayMs = toMs(today);
    const from = Math.min(todayMs, first);
    const dataEnd = Math.max(last, todayMs);
    const span = Math.max(dataEnd - from, 30 * DAY_MS);
    const to = from + span * 1.1;
    const lastStep = steps[steps.length - 1];
    const showAllLine = usableAllGb !== lastStep.usableGb;
    const maxValue = Math.max(
      ...steps.map((s) => Math.max(s.usedCephGb, s.usableGb)),
      showAllLine ? usableAllGb : 0,
    );
    const ticks = niceTicks(maxValue);
    return {
      from,
      to,
      todayMs,
      showAllLine,
      yMax: ticks[ticks.length - 1],
      ticks,
    };
  }, [hasDemand, steps, today, usableAllGb]);

  if (!hasDemand || !geometry) {
    return (
      <div className="space-y-2 rounded-md border bg-card p-4">
        <ChartTitle name={clusterName} region={region} />
        <p className="text-sm text-muted-foreground">
          {t("workspace:datacenter.storage.chart.empty")}
        </p>
      </div>
    );
  }

  const { from, to, todayMs, showAllLine, yMax, ticks } = geometry;
  const x = (ms: number) =>
    plotLeft + ((ms - from) / (to - from)) * (plotRight - plotLeft);
  const y = (gb: number) => plotBottom - (gb / yMax) * (plotBottom - plotTop);

  const points = steps.map((step) => ({
    step,
    x: x(toMs(step.date)),
    yUsed: y(step.usedCephGb),
    yUsable: y(step.usableGb),
  }));
  const lastPoint = points[points.length - 1];
  const demandPath = stepPath(
    points.map((p) => ({ x: p.x, y: p.yUsed })),
    plotRight,
  );
  const capacityPath = stepPath(
    points.map((p) => ({ x: p.x, y: p.yUsable })),
    plotRight,
  );
  const areaPath = `${demandPath}V${plotBottom}H${points[0].x}Z`;

  const overRegions = points.flatMap((p, i) => {
    if (p.step.usedCephGb <= p.step.usableGb) return [];
    const end = i + 1 < points.length ? points[i + 1].x : plotRight;
    return [
      {
        key: p.step.date,
        x: p.x,
        width: end - p.x,
        y: p.yUsed,
        height: p.yUsable - p.yUsed,
      },
    ];
  });
  const markers = points.filter(
    (p, i) => p.step.usedCephGb > (i === 0 ? 0 : steps[i - 1].usedCephGb),
  );

  // End labels: offset vertically when they would collide.
  let demandLabelY = lastPoint.yUsed;
  let capacityLabelY = lastPoint.yUsable;
  if (Math.abs(demandLabelY - capacityLabelY) < LABEL_GAP) {
    const shift = (LABEL_GAP - Math.abs(demandLabelY - capacityLabelY)) / 2;
    if (demandLabelY <= capacityLabelY) {
      demandLabelY -= shift;
      capacityLabelY += shift;
    } else {
      demandLabelY += shift;
      capacityLabelY -= shift;
    }
  }

  const xTicks = timeTicks(from, to, Math.floor((plotRight - plotLeft) / 80));
  const todayX = x(todayMs);
  const todayAnchorEnd = todayX > plotRight - 44;

  const lastStep = steps[steps.length - 1];
  const ariaLabel = t("workspace:datacenter.storage.chart.ariaLabel", {
    cluster: clusterName,
    demand: formatGb(lastStep.usedCephGb, locale),
    lastDate: formatDay(lastStep.date, locale),
    usable: formatGb(lastStep.usableGb, locale),
  });

  // The whole plot area is the hit target; it reports the nearest step.
  const onMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - box.left;
    const py = event.clientY - box.top;
    if (px < plotLeft || px > plotRight || py < plotTop || py > plotBottom) {
      setActive(null);
      return;
    }
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i].x - px) < Math.abs(points[best].x - px)) best = i;
    }
    setActive(best);
  };

  const activePoint = active == null ? null : points[active];
  const tooltipLeft = (() => {
    if (!activePoint) return 0;
    const right = activePoint.x + 12;
    const left =
      right + TOOLTIP_WIDTH > width
        ? activePoint.x - 12 - TOOLTIP_WIDTH
        : right;
    return Math.max(0, Math.min(left, width - TOOLTIP_WIDTH));
  })();

  const percentOf = (step: Step) =>
    step.percent == null ? null : Math.round(step.percent);
  const percentText = (step: Step) => {
    const value = percentOf(step);
    return value == null ? "–" : `${formatNumber(value, locale)}%`;
  };
  const deltaOf = (i: number) =>
    steps[i].usedCephGb - (i === 0 ? 0 : steps[i - 1].usedCephGb);

  const dayLabel = (ms: number, monthly: boolean) =>
    formatDate(
      ms,
      monthly
        ? { month: "short", year: "2-digit", timeZone: "UTC" }
        : { day: "numeric", month: "short", timeZone: "UTC" },
      locale,
    );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setActive((current) =>
        current == null ? 0 : Math.min(current + 1, steps.length - 1),
      );
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setActive((current) =>
        current == null ? steps.length - 1 : Math.max(current - 1, 0),
      );
    } else if (event.key === "Escape") {
      setActive(null);
    }
  };

  const activeStep = active == null ? null : steps[active];
  const activePercent = activeStep ? percentOf(activeStep) : null;
  const activeDelta = active == null ? 0 : deltaOf(active);

  return (
    <div className="space-y-3 rounded-md border bg-card p-4">
      <ChartTitle name={clusterName} region={region} />

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <li className="flex items-center gap-1.5">
          <LegendLine className="text-orange-600" />
          {t("workspace:datacenter.storage.chart.demand")}
        </li>
        <li className="flex items-center gap-1.5">
          <LegendLine className="text-teal-600" />
          {t("workspace:datacenter.storage.chart.usableDelivered")}
        </li>
        {showAllLine && (
          <li className="flex items-center gap-1.5">
            <LegendLine className="text-teal-600" dashed />
            {t("workspace:datacenter.storage.chart.usableAfterOrders")}
          </li>
        )}
        {overRegions.length > 0 && (
          <li className="flex items-center gap-1.5">
            <span className="flex size-4 items-center justify-center rounded-sm bg-destructive/12 text-destructive-foreground">
              <TriangleAlert className="size-3" aria-hidden="true" />
            </span>
            {t("workspace:datacenter.storage.chart.overCapacity")}
          </li>
        )}
      </ul>

      <div ref={ref} className="relative w-full">
        <div
          role="application"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the chart is a keyboard-operable widget (arrow keys move the crosshair)
          tabIndex={0}
          aria-label={ariaLabel}
          onKeyDown={onKeyDown}
          onMouseMove={onMouseMove}
          onMouseLeave={() => setActive(null)}
          className="relative rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ height: HEIGHT }}
        >
          <svg
            width={width}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            className="block text-muted-foreground"
            aria-hidden="true"
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={plotLeft}
                  x2={plotRight}
                  y1={y(tick)}
                  y2={y(tick)}
                  className="stroke-border"
                  strokeWidth={1}
                  opacity={0.6}
                />
                <text
                  x={plotLeft - 8}
                  y={y(tick)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={11}
                  className="fill-muted-foreground"
                >
                  {formatGb(tick, locale)}
                </text>
              </g>
            ))}
            {xTicks.map((tick) => (
              <text
                key={tick.ms}
                x={x(tick.ms)}
                y={plotBottom + 16}
                textAnchor="middle"
                fontSize={11}
                className="fill-muted-foreground"
              >
                {dayLabel(tick.ms, tick.monthly)}
              </text>
            ))}

            {overRegions.map((over) => (
              <rect
                key={over.key}
                data-testid="over-capacity-region"
                x={over.x}
                y={over.y}
                width={Math.max(over.width, 0)}
                height={Math.max(over.height, 0)}
                className="fill-destructive/12"
              />
            ))}

            <g className="text-orange-600">
              <path
                d={areaPath}
                fill="currentColor"
                fillOpacity={0.08}
                stroke="none"
              />
            </g>
            <path
              data-testid="capacity-line"
              d={capacityPath}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinejoin="round"
              className="text-teal-600"
            />
            {showAllLine && (
              <line
                data-testid="capacity-after-orders-line"
                x1={plotLeft}
                x2={plotRight}
                y1={y(usableAllGb)}
                y2={y(usableAllGb)}
                stroke="currentColor"
                strokeWidth={2}
                strokeDasharray="6 4"
                className="text-teal-600"
              />
            )}
            <path
              data-testid="demand-line"
              d={demandPath}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinejoin="round"
              className="text-orange-600"
            />

            <line
              x1={todayX}
              x2={todayX}
              y1={plotTop}
              y2={plotBottom}
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            <text
              x={todayAnchorEnd ? todayX - 4 : todayX + 4}
              y={plotTop + 10}
              textAnchor={todayAnchorEnd ? "end" : "start"}
              fontSize={11}
              className="fill-muted-foreground"
            >
              {t("workspace:datacenter.storage.chart.today")}
            </text>

            <g className="text-orange-600">
              {markers.map((p) => (
                <circle
                  key={p.step.date}
                  data-testid="demand-marker"
                  cx={p.x}
                  cy={p.yUsed}
                  r={MARKER_RADIUS}
                  fill="currentColor"
                  className="stroke-card"
                  strokeWidth={2}
                />
              ))}
            </g>

            <text
              x={plotRight + 6}
              y={demandLabelY}
              dominantBaseline="middle"
              fontSize={11}
              fontWeight={500}
              className="fill-foreground"
            >
              {formatGb(lastStep.usedCephGb, locale)}
            </text>
            <text
              x={plotRight + 6}
              y={capacityLabelY}
              dominantBaseline="middle"
              fontSize={11}
              className="fill-muted-foreground"
            >
              {formatGb(lastStep.usableGb, locale)}
            </text>

            {activePoint && (
              <line
                data-testid="crosshair"
                x1={activePoint.x}
                x2={activePoint.x}
                y1={plotTop}
                y2={plotBottom}
                stroke="currentColor"
                strokeWidth={1}
              />
            )}
          </svg>

          {activeStep && activePoint && (
            <div
              role="status"
              data-testid="chart-tooltip"
              className="pointer-events-none absolute z-10 space-y-1 rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-md"
              style={{
                left: tooltipLeft,
                top: plotTop + 8,
                width: TOOLTIP_WIDTH,
              }}
            >
              <p className="font-medium">
                {formatDay(activeStep.date, locale)}
              </p>
              <p className="flex justify-between gap-2">
                <span className="text-muted-foreground">
                  {t("workspace:datacenter.storage.chart.demand")}
                </span>
                <span className="tabular-nums">
                  {formatGb(activeStep.usedCephGb, locale)}
                  {activeDelta > 0 && (
                    <span className="text-muted-foreground">
                      {" "}
                      (+{formatGb(activeDelta, locale)})
                    </span>
                  )}
                </span>
              </p>
              <p className="flex justify-between gap-2">
                <span className="text-muted-foreground">
                  {t("workspace:datacenter.storage.chart.usableDelivered")}
                </span>
                <span className="tabular-nums">
                  {formatGb(activeStep.usableGb, locale)}
                </span>
              </p>
              <p className="flex justify-between gap-2">
                <span className="text-muted-foreground">
                  {t("workspace:datacenter.storage.chart.percentOfUsable")}
                </span>
                <span className="flex items-center gap-1 tabular-nums">
                  {activePercent != null && activePercent >= 80 && (
                    <TriangleAlert
                      className="size-3 text-destructive-foreground"
                      aria-hidden="true"
                    />
                  )}
                  {percentText(activeStep)}
                  {activePercent != null && activePercent >= 80 && (
                    <span className="text-destructive-foreground">
                      {activePercent > 100
                        ? t("workspace:datacenter.storage.chart.overCapacity")
                        : t("workspace:datacenter.storage.chart.nearCapacity")}
                    </span>
                  )}
                </span>
              </p>
            </div>
          )}
        </div>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="xs"
        aria-expanded={showTable}
        aria-controls={tableId}
        onClick={() => setShowTable((value) => !value)}
      >
        {showTable
          ? t("workspace:datacenter.storage.chart.hideTable")
          : t("workspace:datacenter.storage.chart.showTable")}
      </Button>
      {showTable && (
        <div id={tableId} className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t("workspace:datacenter.storage.chart.tableDate")}
                </TableHead>
                <TableHead className="text-right">
                  {t("workspace:datacenter.storage.chart.demand")}
                </TableHead>
                <TableHead className="text-right">
                  {t("workspace:datacenter.storage.chart.tableChange")}
                </TableHead>
                <TableHead className="text-right">
                  {t("workspace:datacenter.storage.chart.usableDelivered")}
                </TableHead>
                <TableHead className="text-right">
                  {t("workspace:datacenter.storage.chart.percentOfUsable")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {steps.map((step, i) => {
                const delta = deltaOf(i);
                return (
                  <TableRow key={step.date}>
                    <TableCell className="whitespace-nowrap">
                      {formatDay(step.date, locale)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatGb(step.usedCephGb, locale)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {delta > 0 ? `+${formatGb(delta, locale)}` : "–"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatGb(step.usableGb, locale)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {percentText(step)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function ChartTitle({ name, region }: { name: string; region: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h4 className="text-sm font-medium">{name}</h4>
      <Badge variant="outline" size="sm">
        {region}
      </Badge>
    </div>
  );
}
