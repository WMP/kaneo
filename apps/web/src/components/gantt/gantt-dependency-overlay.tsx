import { useTranslation } from "react-i18next";
import TaskRelationDependencyPopover from "@/components/task/task-relation-dependency-popover";
import { cn } from "@/lib/cn";
import type { DependencyEdgeGeometry } from "./dependency-lines";
import {
  computeFanInCollapse,
  DENSE_EDGE_THRESHOLD,
  filterEdgesForDisplayMode,
  type GanttDependencyDisplayMode,
  isEdgeFocused,
  shouldShowTypeLabel,
} from "./gantt-dependency-display";
import type { Point } from "./gantt-link-drag";

type GanttDependencyOverlayProps = {
  edges: DependencyEdgeGeometry[];
  hoveredTaskId: string | null;
  /** Edge ids on the currently-highlighted critical path (see
   * gantt-critical-path.ts). Undefined/empty draws every line exactly as
   * before — this is purely additive. */
  criticalEdgeIds?: ReadonlySet<string>;
  /** Edge ids of "blocks" edges whose constraint is currently broken by the
   * tasks' dates (see gantt-dependency-violations.ts). Only these are drawn
   * red; a satisfied blocking edge is neutral. Undefined/empty: none red. */
  violatedEdgeIds?: ReadonlySet<string>;
  /** The task kept in focus while nothing is hovered (the task open in the
   * details sheet). Its edges are treated like a hovered task's edges. */
  pinnedTaskId?: string | null;
  /** Which edges are drawn at all. Defaults to "all". "hidden" draws no
   * connectors but still draws the link-drag preview. */
  displayMode?: GanttDependencyDisplayMode;
  /** Pixels from the overlay's left edge to where the timeline (day) columns
   * start — a backward-scheduled edge's curve can bow further left than its
   * target point, and this clips it so it never bleeds into the sticky task
   * rail beside it. */
  clipLeftPx: number;
  /** The in-progress "drag to create a dependency" gesture (see
   * handleLinkDragStart in gantt.tsx): a straight line from the source bar's
   * finish edge to the current pointer position, drawn while the gesture is
   * live and gone once it ends (dropped, cancelled, or completed — the real
   * edge then appears via the usual relations refetch). */
  preview?: { source: Point; pointer: Point } | null;
  /** The label of a task whose edge is drawn only as a stub because the task
   * is outside the visible time window: its key as shown in the Gantt rail
   * and the already formatted date of the end (`anchorSide` "end") or start
   * the edge anchors to. Null/undefined: the stub is drawn without a chip. */
  resolveOffWindowTask?: (
    taskId: string,
    anchorSide: "start" | "end",
  ) => { key: string; dateText: string } | null;
  /** Brings an off-window task into view (chip click). Without it the chip is
   * not rendered. */
  onJumpToTask?: (taskId: string, anchorSide: "start" | "end") => void;
  /** Pixels from the overlay's left edge to where the timeline ends: a chip
   * is kept left of it. Optional; unbounded when omitted. */
  clipRightPx?: number;
  /** The project a task belongs to. Editing an edge's dependency type needs
   * task:update in the SOURCE task's project, which differs per edge on the
   * cross-project portfolio. */
  resolveProjectId: (taskId: string) => string | undefined;
};

// Resting/emphasized/dimmed visual states for the connector lines. Hovering
// a task bar (driven from gantt.tsx via `hoveredTaskId`) brings its own
// edges to full strength and fades every other edge down, rather than
// toggling a binary highlighted/not state, so the chart still reads as one
// picture instead of flashing between two very different views.
const REST_OPACITY = 0.45;
const DIMMED_OPACITY = 0.12;
// Above DENSE_EDGE_THRESHOLD rendered edges, unfocused edges rest at this
// lower opacity so the focused ones (hovered/pinned task) stand out.
const DENSE_REST_OPACITY = 0.22;
// Stroke-opacity of a violated edge in the top layer (it is not part of the
// rest group, so it must stay readable on its own).
const VIOLATED_OPACITY = 0.9;
// Size of the fan-in badge ("← 7") drawn beside a target whose incoming
// branches are collapsed.
const FAN_IN_BADGE_WIDTH_PX = 34;
const FAN_IN_BADGE_HEIGHT_PX = 16;
// Jump chip ("← AFB-13 · Mar 3"): width is estimated from its text, capped.
const CHIP_HEIGHT_PX = 16;
const CHIP_CHAR_WIDTH_PX = 5.4;
const CHIP_PADDING_PX = 10;
const CHIP_MAX_WIDTH_PX = 190;
const CHIP_GAP_PX = 2;
const REST_WIDTH = 1.5;
const EMPHASIZED_WIDTH = 2.5;

export function GanttDependencyOverlay({
  edges,
  hoveredTaskId,
  criticalEdgeIds,
  violatedEdgeIds,
  pinnedTaskId = null,
  displayMode = "all",
  clipLeftPx,
  clipRightPx,
  preview = null,
  resolveProjectId,
  resolveOffWindowTask,
  onJumpToTask,
}: GanttDependencyOverlayProps) {
  const { t } = useTranslation();
  const filteredEdges = filterEdgesForDisplayMode(edges, displayMode, {
    hoveredTaskId,
    pinnedTaskId,
    criticalEdgeIds,
  });
  if (filteredEdges.length === 0 && !preview) return null;
  // A target with many incoming edges shows one badge instead of its
  // unfocused, non-violated, non-critical branches.
  const { collapsedEdgeIds, badges: fanInBadges } = computeFanInCollapse(
    filteredEdges,
    { hoveredTaskId, pinnedTaskId, criticalEdgeIds, violatedEdgeIds },
  );
  const visibleEdges = filteredEdges.filter(
    (edge) => !collapsedEdgeIds.has(edge.id),
  );
  const focusActive = hoveredTaskId !== null || pinnedTaskId !== null;
  const restGroupOpacity = focusActive
    ? DIMMED_OPACITY
    : visibleEdges.length > DENSE_EDGE_THRESHOLD
      ? DENSE_REST_OPACITY
      : REST_OPACITY;

  const isViolatedEdge = (edge: DependencyEdgeGeometry) =>
    edge.relationType === "blocks" && (violatedEdgeIds?.has(edge.id) ?? false);
  const isTop = (edge: DependencyEdgeGeometry) =>
    isViolatedEdge(edge) || isEdgeFocused(edge, hoveredTaskId, pinnedTaskId);
  const restEdges = visibleEdges.filter((edge) => !isTop(edge));
  const topEdges = visibleEdges.filter(isTop);

  // One edge's line (plus its critical-path halo, drawn first). Rest edges
  // draw at stroke-opacity 1 inside the rest group, which carries the
  // opacity; top-layer edges carry their own.
  const renderEdgeLines = (edge: DependencyEdgeGeometry, top: boolean) => {
    const isBlocking = edge.relationType === "blocks";
    const isViolated = isViolatedEdge(edge);
    const isIncident = isEdgeFocused(edge, hoveredTaskId, pinnedTaskId);
    const isDimmed = focusActive && !isIncident;
    const lineKind = !isBlocking
      ? "related"
      : isViolated
        ? "violated"
        : "blocks";
    const lineColor = isViolated
      ? "var(--destructive)"
      : isIncident
        ? "var(--foreground)"
        : "var(--muted-foreground)";
    const markerKind = isViolated
      ? "violated"
      : isIncident
        ? "focused"
        : lineKind;
    const isCritical = criticalEdgeIds?.has(edge.id) ?? false;
    const strokeWidth = isIncident ? EMPHASIZED_WIDTH : REST_WIDTH;
    const lineOpacity = !top
      ? 1
      : isViolated
        ? isDimmed
          ? DIMMED_OPACITY
          : VIOLATED_OPACITY
        : 1;
    const haloOpacity = !top ? 0.85 : isDimmed ? DIMMED_OPACITY : 0.85;

    return (
      <g key={edge.id}>
        {/* Critical-path accent: a wider amber halo drawn BEHIND the edge's
            own line, rather than recoloring it, so it reads regardless of hue
            perception (it differs in shape, not only in color). */}
        {isCritical && (
          <path
            d={edge.path}
            fill="none"
            stroke="var(--warning)"
            strokeWidth={strokeWidth + 3}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity={haloOpacity}
            // Explicit, not just inherited from the svg root's own
            // pointer-events-none: at Month/Quarter a connector's routed path
            // often runs directly over a bar compressed down to a sliver (see
            // MIN_BAR_HOVER_HIT_PX in timeline.ts), and this line visually
            // paints ABOVE that bar (z-[9] overlay vs. z-[1] bars) — without
            // this, the line would win the pointer hit-test there and the bar
            // underneath would never see its own hover.
            style={{ pointerEvents: "none" }}
            className="transition-[stroke-opacity] duration-150 ease-out"
          />
        )}
        <path
          d={edge.path}
          fill="none"
          data-edge-kind={lineKind}
          stroke={lineColor}
          // Related edges differ from blocking ones by shape (dashed), not
          // only by color.
          strokeDasharray={isBlocking ? undefined : "5 4"}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeOpacity={lineOpacity}
          markerEnd={`url(#gantt-dependency-arrow-${markerKind})`}
          // See the critical-path halo path's own comment above.
          style={{ pointerEvents: "none" }}
          className="transition-[stroke-opacity,stroke-width] duration-150 ease-out"
        />
      </g>
    );
  };

  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: not an icon/image svg — a plain positioning container mixing decorative <path> connectors with a real interactive foreignObject control per "blocks" edge (the type label, which carries its own accessible name via its button/title), so one <title> for the whole svg would misdescribe it either way
    <svg
      // NOT aria-hidden, unlike a purely decorative overlay: the type label
      // above is a real, focusable control, not just a picture of one.
      // Below the per-row sticky task rail (z-[11] in the gantt route) so a
      // curve that scrolls under the pinned rail is occluded by it rather
      // than painting on top — that relationship holds at any scrollLeft,
      // unlike the clip-path below (which is expressed in the overlay's own,
      // scrolling coordinate space and only lines up with the rail pre-scroll).
      // Still above the day-grid background and the task bars themselves.
      className="pointer-events-none absolute inset-0 z-[9] h-full w-full overflow-visible"
      // Only the left edge is meant to protect the sticky task rail; top and
      // bottom stay wide open (a large negative inset, rather than 0) so a
      // backward or looping connector whose detour lane runs past the
      // overlay's own vertical bounds (see buildElbowPoints's "below" lane,
      // which can sit under the last row) still renders in full. An "above"
      // lane is never placed above the first row: that area is under the
      // opaque sticky timeline header, which would hide it.
      style={{
        clipPath: `inset(-2000px 0 -2000px ${Math.max(clipLeftPx, 0)}px)`,
      }}
    >
      <defs>
        <marker
          id="gantt-dependency-arrow-blocks"
          viewBox="0 0 10 10"
          refX="8.5"
          refY="5"
          markerWidth="6.5"
          markerHeight="6.5"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-foreground)" />
        </marker>
        <marker
          id="gantt-dependency-arrow-focused"
          viewBox="0 0 10 10"
          refX="8.5"
          refY="5"
          markerWidth="6.5"
          markerHeight="6.5"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--foreground)" />
        </marker>
        <marker
          id="gantt-dependency-arrow-violated"
          viewBox="0 0 10 10"
          refX="8.5"
          refY="5"
          markerWidth="6.5"
          markerHeight="6.5"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--destructive)" />
        </marker>
        <marker
          id="gantt-dependency-arrow-related"
          viewBox="0 0 10 10"
          refX="8.5"
          refY="5"
          markerWidth="6.5"
          markerHeight="6.5"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-foreground)" />
        </marker>
      </defs>
      {/* Rest layer: every unfocused, non-violated edge lives in ONE group
          that carries the rest opacity. Group opacity composites the group
          once, so dozens of overlapping vertical runs no longer add up to a
          solid bright bundle the way per-path stroke-opacity does. */}
      <g
        data-testid="gantt-dependency-rest-layer"
        opacity={restGroupOpacity}
        className="transition-opacity duration-150 ease-out"
      >
        {restEdges.map((edge) => renderEdgeLines(edge, false))}
      </g>
      {/* Top layer: focused and violated edges, painted after the rest group
          so they sit above it. */}
      <g data-testid="gantt-dependency-top-layer">
        {topEdges.map((edge) => renderEdgeLines(edge, true))}
      </g>
      {/* Type labels come last among the edges so no line ever covers them. */}
      {visibleEdges.map((edge) => {
        if (!edge.typeLabelPoint) return null;
        const isViolated = isViolatedEdge(edge);
        const isIncident = isEdgeFocused(edge, hoveredTaskId, pinnedTaskId);
        if (!shouldShowTypeLabel(edge, isIncident)) return null;
        const isDimmed = focusActive && !isIncident;
        return (
          <foreignObject
            key={`label-${edge.id}`}
            x={edge.typeLabelPoint.x - 30}
            y={edge.typeLabelPoint.y - 14}
            width={60}
            height={16}
            style={{ overflow: "visible" }}
            className={cn(
              "pointer-events-auto transition-opacity duration-150 ease-out",
              isDimmed && "opacity-[0.12]",
            )}
          >
            <TaskRelationDependencyPopover
              relationId={edge.id}
              taskId={edge.sourceTaskId}
              projectId={resolveProjectId(edge.sourceTaskId)}
              dependencyType={edge.dependencyType ?? "fs"}
              lagDays={edge.lagDays ?? 0}
            >
              <button
                type="button"
                title={t(
                  `tasks:relations.dependency.types.${edge.dependencyType ?? "fs"}`,
                )}
                className={cn(
                  "block w-full select-none truncate rounded border border-border/60 bg-background/90 px-1 text-[9px] font-semibold leading-4 shadow-sm hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  isViolated ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {t(
                  `tasks:relations.dependency.typesShort.${edge.dependencyType ?? "fs"}`,
                  {
                    defaultValue: (edge.dependencyType ?? "fs").toUpperCase(),
                  },
                )}
                {edge.lagDays !== undefined &&
                  edge.lagDays !== 0 &&
                  t("tasks:relations.dependency.lagSuffix", {
                    days: edge.lagDays > 0 ? `+${edge.lagDays}` : edge.lagDays,
                  })}
              </button>
            </TaskRelationDependencyPopover>
          </foreignObject>
        );
      })}
      {/* Fan-in badges: one per target whose many incoming branches are
          folded away. A real (hoverable) element so the tooltip and its
          accessible name are available; it is not interactive otherwise. */}
      {fanInBadges.map((badge) => {
        const label = t("tasks:gantt.dependencyFanIn", { count: badge.count });
        return (
          <foreignObject
            key={`fan-in-${badge.key}`}
            data-testid="gantt-dependency-fan-in"
            x={
              badge.side === "start"
                ? badge.point.x - FAN_IN_BADGE_WIDTH_PX - 4
                : badge.point.x + 4
            }
            y={badge.point.y - FAN_IN_BADGE_HEIGHT_PX / 2}
            width={FAN_IN_BADGE_WIDTH_PX}
            height={FAN_IN_BADGE_HEIGHT_PX}
            style={{ overflow: "visible" }}
            className={cn(
              "pointer-events-auto transition-opacity duration-150 ease-out",
              focusActive && "opacity-40",
            )}
          >
            <span
              role="img"
              aria-label={label}
              title={label}
              className="block w-full select-none truncate rounded border border-border/60 bg-background/90 px-1 text-center text-[9px] font-semibold leading-4 text-muted-foreground shadow-sm"
            >
              {badge.side === "start" ? "← " : ""}
              {badge.count}
              {badge.side === "end" ? " →" : ""}
            </span>
          </foreignObject>
        );
      })}
      {/* Jump chips for edges whose far end is outside the visible time
          window: a real, focusable button that brings that task into view. */}
      {onJumpToTask &&
        visibleEdges.map((edge) => {
          const stub = edge.stub;
          if (!stub) return null;
          const info = resolveOffWindowTask?.(stub.taskId, stub.anchorSide);
          if (!info) return null;
          const dateText = info.dateText;
          const text =
            stub.taskSide === "before"
              ? `← ${info.key} · ${dateText}`
              : `${info.key} · ${dateText} →`;
          const width = Math.min(
            CHIP_MAX_WIDTH_PX,
            CHIP_PADDING_PX + text.length * CHIP_CHAR_WIDTH_PX,
          );
          let x =
            stub.chipDir === -1
              ? stub.chipPoint.x - width - CHIP_GAP_PX
              : stub.chipPoint.x + CHIP_GAP_PX;
          if (clipRightPx !== undefined) {
            x = Math.min(x, clipRightPx - width - CHIP_GAP_PX);
          }
          x = Math.max(x, Math.max(clipLeftPx, 0) + CHIP_GAP_PX);
          const isDimmed =
            focusActive && !isEdgeFocused(edge, hoveredTaskId, pinnedTaskId);
          const name = t("tasks:gantt.dependencyChipAriaLabel", {
            key: info.key,
          });
          return (
            <foreignObject
              key={`chip-${edge.id}`}
              data-testid="gantt-dependency-chip"
              x={x}
              y={stub.chipPoint.y - CHIP_HEIGHT_PX / 2}
              width={width}
              height={CHIP_HEIGHT_PX}
              style={{ overflow: "visible" }}
              className={cn(
                "pointer-events-auto transition-opacity duration-150 ease-out",
                isDimmed && "opacity-40",
              )}
            >
              <button
                type="button"
                aria-label={name}
                title={name}
                onClick={() => onJumpToTask(stub.taskId, stub.anchorSide)}
                className="block w-full select-none truncate rounded border border-border/60 bg-background/90 px-1 text-[9px] font-medium leading-4 text-muted-foreground shadow-sm hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {text}
              </button>
            </foreignObject>
          );
        })}
      {preview && (
        <path
          data-testid="gantt-link-preview"
          d={`M ${preview.source.x} ${preview.source.y} L ${preview.pointer.x} ${preview.pointer.y}`}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={2}
          strokeDasharray="4 3"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
