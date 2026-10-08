import { useTranslation } from "react-i18next";
import TaskRelationDependencyPopover from "@/components/task/task-relation-dependency-popover";
import { cn } from "@/lib/cn";
import type { DependencyEdgeGeometry } from "./dependency-lines";
import {
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
const REST_OPACITY = 0.55;
const DIMMED_OPACITY = 0.12;
// Above DENSE_EDGE_THRESHOLD rendered edges, unfocused edges rest at this
// lower opacity so the focused ones (hovered/pinned task) stand out.
const DENSE_REST_OPACITY = 0.3;
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
  preview = null,
  resolveProjectId,
}: GanttDependencyOverlayProps) {
  const { t } = useTranslation();
  const visibleEdges = filterEdgesForDisplayMode(edges, displayMode, {
    hoveredTaskId,
    pinnedTaskId,
    criticalEdgeIds,
  });
  if (visibleEdges.length === 0 && !preview) return null;
  const restOpacity =
    visibleEdges.length > DENSE_EDGE_THRESHOLD
      ? DENSE_REST_OPACITY
      : REST_OPACITY;

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
      {visibleEdges.map((edge) => {
        const isBlocking = edge.relationType === "blocks";
        const isViolated =
          isBlocking && (violatedEdgeIds?.has(edge.id) ?? false);
        // Focused: incident to the hovered task or to the pinned one.
        const isIncident = isEdgeFocused(edge, hoveredTaskId, pinnedTaskId);
        const isDimmed = hoveredTaskId !== null && !isIncident;
        const lineKind = !isBlocking
          ? "related"
          : isViolated
            ? "violated"
            : "blocks";
        const lineColor = isViolated
          ? "var(--destructive)"
          : isBlocking
            ? "var(--foreground)"
            : "var(--muted-foreground)";
        const isCritical = criticalEdgeIds?.has(edge.id) ?? false;
        const strokeWidth = isIncident ? EMPHASIZED_WIDTH : REST_WIDTH;

        return (
          <g key={edge.id}>
            {/* Critical-path accent: a wider amber halo drawn BEHIND the
                edge's own (red/gray) line, rather than recoloring it —
                blocking lines are already red, so a plain color swap would
                be indistinguishable from "blocking", and this reads
                correctly regardless of hue perception since it differs in
                shape (a visible halo), not only in color. */}
            {isCritical && (
              <path
                d={edge.path}
                fill="none"
                stroke="var(--warning)"
                strokeWidth={strokeWidth + 3}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeOpacity={isDimmed ? DIMMED_OPACITY : 0.85}
                // Explicit, not just inherited from the svg root's own
                // pointer-events-none: at Month/Quarter a connector's routed
                // path often runs directly over a bar compressed down to a
                // sliver (see MIN_BAR_HOVER_HIT_PX in timeline.ts), and this
                // line visually paints ABOVE that bar (z-[9] overlay vs.
                // z-[1] bars) — without this, the line would win the pointer
                // hit-test there and the bar underneath would never see its
                // own hover, killing dependency-line highlighting exactly
                // where it matters most.
                style={{ pointerEvents: "none" }}
                className="transition-[stroke-opacity] duration-150 ease-out"
              />
            )}
            <path
              d={edge.path}
              fill="none"
              data-edge-kind={lineKind}
              stroke={lineColor}
              // Related edges differ from blocking ones by shape (dashed),
              // not only by color.
              strokeDasharray={isBlocking ? undefined : "5 4"}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeOpacity={
                isDimmed ? DIMMED_OPACITY : isIncident ? 1 : restOpacity
              }
              markerEnd={`url(#gantt-dependency-arrow-${lineKind})`}
              // See the critical-path halo path's own comment above.
              style={{ pointerEvents: "none" }}
              className="transition-[stroke-opacity,stroke-width] duration-150 ease-out"
            />
            {/* Dependency-TYPE label (FS/SS/FF/SF, plus a "+Nd"/"-Nd" suffix
                once there's a lag — see the summary composition already used
                on a task's own relation list, task-relations.tsx): every
                "blocks" edge gets one EXCEPT a plain FS edge with no lag at
                rest (the default says nothing and would only add noise on a
                large chart) — that one shows while the edge is focused
                (typeLabelPoint is null for "related",
                whose type is never meaningful), it sits in its TARGET's row
                beside the connector's last vertical run (see
                buildDependencyEdges in dependency-lines.ts), so several
                edges sharing a source each read as attached to their own
                target, and it's a
                real control — reusing TaskRelationDependencyPopover, the
                same editor a task's own relation list already opens — not
                just a picture of the type, so the chart itself is a second
                place (besides that list) to fix a wrongly-typed dependency. */}
            {edge.typeLabelPoint && shouldShowTypeLabel(edge, isIncident) && (
              <foreignObject
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
                      isViolated ? "text-destructive" : "text-foreground",
                    )}
                  >
                    {t(
                      `tasks:relations.dependency.typesShort.${edge.dependencyType ?? "fs"}`,
                      {
                        defaultValue: (
                          edge.dependencyType ?? "fs"
                        ).toUpperCase(),
                      },
                    )}
                    {edge.lagDays !== undefined &&
                      edge.lagDays !== 0 &&
                      t("tasks:relations.dependency.lagSuffix", {
                        days:
                          edge.lagDays > 0 ? `+${edge.lagDays}` : edge.lagDays,
                      })}
                  </button>
                </TaskRelationDependencyPopover>
              </foreignObject>
            )}
          </g>
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
