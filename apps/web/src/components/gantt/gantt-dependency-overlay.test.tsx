import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DependencyEdgeGeometry } from "./dependency-lines";
import { DENSE_EDGE_THRESHOLD } from "./gantt-dependency-display";
import { GanttDependencyOverlay } from "./gantt-dependency-overlay";

vi.mock("@/components/task/task-relation-dependency-popover", () => ({
  default: (props: {
    taskId: string;
    projectId: string | undefined;
    children: React.ReactNode;
  }) => (
    <div
      data-testid="popover"
      data-task={props.taskId}
      data-project={props.projectId}
    >
      {props.children}
    </div>
  ),
}));

function labels(container: HTMLElement) {
  return container.querySelectorAll("[data-testid=popover]");
}

function edge(overrides: Partial<DependencyEdgeGeometry> = {}) {
  return {
    id: "e1",
    sourceTaskId: "a",
    targetTaskId: "b",
    relationType: "blocks" as const,
    path: "M 0 0 L 10 10",
    sourcePoint: { x: 0, y: 0 },
    targetPoint: { x: 10, y: 10 },
    lagLabelPoint: null,
    typeLabelPoint: null,
    ...overrides,
  };
}

describe("GanttDependencyOverlay", () => {
  it("clips only the left rail region, leaving top and bottom open so a backward/looping connector that routes above the first row or below the last row is not cut off", () => {
    const { container } = render(
      <GanttDependencyOverlay
        edges={[edge()]}
        hoveredTaskId={null}
        clipLeftPx={320}
        resolveProjectId={() => "project-1"}
      />,
    );

    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    const clipPath = svg?.style.clipPath ?? "";
    // Left inset matches the rail width...
    expect(clipPath).toContain("320px");
    // ...but top/bottom are NOT clipped flush to the box's own edges (an
    // `inset(0 0 0 320px)` cuts off anything the path draws above row 0 or
    // below the last row); they're pushed far out instead.
    expect(clipPath).not.toMatch(/inset\(0px? 0px? 0px? 320px\)/);
    expect(clipPath).toMatch(/-\d{3,}px/);
  });

  it("renders nothing when there are no edges", () => {
    const { container } = render(
      <GanttDependencyOverlay
        edges={[]}
        hoveredTaskId={null}
        clipLeftPx={0}
        resolveProjectId={() => undefined}
      />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("edits each dependency with the rights of its SOURCE task's own project", () => {
    const { getAllByTestId } = render(
      <GanttDependencyOverlay
        edges={[
          edge({
            id: "own",
            sourceTaskId: "own-task",
            dependencyType: "ss",
            typeLabelPoint: { x: 1, y: 1 },
          }),
          edge({
            id: "cross",
            sourceTaskId: "external-task",
            dependencyType: "ss",
            typeLabelPoint: { x: 2, y: 2 },
          }),
        ]}
        hoveredTaskId={null}
        clipLeftPx={0}
        resolveProjectId={(taskId) =>
          taskId === "external-task" ? "project-other" : "project-here"
        }
      />,
    );

    const byTask = new Map(
      getAllByTestId("popover").map((node) => [
        node.getAttribute("data-task"),
        node.getAttribute("data-project"),
      ]),
    );
    expect(byTask.get("own-task")).toBe("project-here");
    expect(byTask.get("external-task")).toBe("project-other");
  });

  describe("type label", () => {
    const point = { typeLabelPoint: { x: 1, y: 1 } };

    it("hides the label of a plain FS edge with no lag at rest", () => {
      const { container } = render(
        <GanttDependencyOverlay
          edges={[
            edge(point),
            edge({ ...point, id: "e2", dependencyType: "fs", lagDays: 0 }),
          ]}
          hoveredTaskId={null}
          clipLeftPx={0}
          resolveProjectId={() => "p"}
        />,
      );
      expect(labels(container)).toHaveLength(0);
    });

    it("shows the label of a plain FS edge while its task is hovered or pinned", () => {
      const hovered = render(
        <GanttDependencyOverlay
          edges={[edge(point)]}
          hoveredTaskId="b"
          clipLeftPx={0}
          resolveProjectId={() => "p"}
        />,
      );
      expect(labels(hovered.container)).toHaveLength(1);

      const pinned = render(
        <GanttDependencyOverlay
          edges={[edge(point)]}
          hoveredTaskId={null}
          pinnedTaskId="a"
          clipLeftPx={0}
          resolveProjectId={() => "p"}
        />,
      );
      expect(labels(pinned.container)).toHaveLength(1);
    });

    it("keeps the labels of SS/FF/SF edges and of an FS edge with a lag", () => {
      const { container } = render(
        <GanttDependencyOverlay
          edges={[
            edge({ ...point, id: "ss", dependencyType: "ss" }),
            edge({ ...point, id: "ff", dependencyType: "ff" }),
            edge({ ...point, id: "sf", dependencyType: "sf" }),
            edge({ ...point, id: "lag", dependencyType: "fs", lagDays: 2 }),
          ]}
          hoveredTaskId={null}
          clipLeftPx={0}
          resolveProjectId={() => "p"}
        />,
      );
      expect(labels(container)).toHaveLength(4);
    });

    it("colors the label red only for a violated edge", () => {
      const { container } = render(
        <GanttDependencyOverlay
          edges={[
            edge({ ...point, id: "ok", dependencyType: "ss" }),
            edge({ ...point, id: "bad", dependencyType: "ff" }),
          ]}
          violatedEdgeIds={new Set(["bad"])}
          hoveredTaskId={null}
          clipLeftPx={0}
          resolveProjectId={() => "p"}
        />,
      );
      const buttons = container.querySelectorAll("button");
      expect(buttons[0]?.className).not.toContain("text-destructive");
      expect(buttons[1]?.className).toContain("text-destructive");
    });
  });

  describe("line style", () => {
    function paths(container: HTMLElement) {
      return container.querySelectorAll<SVGPathElement>("svg path[stroke]");
    }

    it("draws a satisfied blocking edge neutral and solid, not red", () => {
      const { container } = render(
        <GanttDependencyOverlay
          edges={[edge()]}
          hoveredTaskId={null}
          clipLeftPx={0}
          resolveProjectId={() => "p"}
        />,
      );
      const line = paths(container)[0];
      expect(line?.getAttribute("stroke")).toBe("var(--foreground)");
      expect(line?.getAttribute("stroke-dasharray")).toBeNull();
      expect(line?.getAttribute("marker-end")).toContain("arrow-blocks");
    });

    it("draws a violated blocking edge red with a matching arrow", () => {
      const { container } = render(
        <GanttDependencyOverlay
          edges={[edge()]}
          violatedEdgeIds={new Set(["e1"])}
          hoveredTaskId={null}
          clipLeftPx={0}
          resolveProjectId={() => "p"}
        />,
      );
      const line = paths(container)[0];
      expect(line?.getAttribute("stroke")).toBe("var(--destructive)");
      expect(line?.getAttribute("marker-end")).toContain("arrow-violated");
    });

    it("draws a related edge dashed and muted, never red", () => {
      const { container } = render(
        <GanttDependencyOverlay
          edges={[edge({ relationType: "related" })]}
          violatedEdgeIds={new Set(["e1"])}
          hoveredTaskId={null}
          clipLeftPx={0}
          resolveProjectId={() => "p"}
        />,
      );
      const line = paths(container)[0];
      expect(line?.getAttribute("stroke")).toBe("var(--muted-foreground)");
      expect(line?.getAttribute("stroke-dasharray")).toBeTruthy();
    });
  });

  describe("density", () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        edge({ id: `e${i}`, sourceTaskId: `s${i}`, targetTaskId: `t${i}` }),
      );
    const opacities = (container: HTMLElement) =>
      [...container.querySelectorAll("svg path[stroke]")].map((node) =>
        node.getAttribute("stroke-opacity"),
      );

    it("keeps the normal resting opacity at the threshold", () => {
      const { container } = render(
        <GanttDependencyOverlay
          edges={many(DENSE_EDGE_THRESHOLD)}
          hoveredTaskId={null}
          clipLeftPx={0}
          resolveProjectId={() => "p"}
        />,
      );
      expect(new Set(opacities(container))).toEqual(new Set(["0.55"]));
    });

    it("lowers the opacity of unfocused edges above the threshold and keeps pinned edges at full strength", () => {
      const { container } = render(
        <GanttDependencyOverlay
          edges={many(DENSE_EDGE_THRESHOLD + 1)}
          hoveredTaskId={null}
          pinnedTaskId="s0"
          clipLeftPx={0}
          resolveProjectId={() => "p"}
        />,
      );
      const values = opacities(container);
      expect(values[0]).toBe("1");
      expect(new Set(values.slice(1))).toEqual(new Set(["0.3"]));
    });
  });

  describe("display mode", () => {
    const edges = [
      edge({ id: "e1", sourceTaskId: "a", targetTaskId: "b" }),
      edge({ id: "e2", sourceTaskId: "c", targetTaskId: "d" }),
    ];
    const lineCount = (container: HTMLElement) =>
      container.querySelectorAll("svg path[stroke]").length;

    it("focused draws only the hovered or pinned task's edges", () => {
      const none = render(
        <GanttDependencyOverlay
          edges={edges}
          displayMode="focused"
          hoveredTaskId={null}
          clipLeftPx={0}
          resolveProjectId={() => "p"}
        />,
      );
      expect(none.container.querySelector("svg")).toBeNull();

      const hovered = render(
        <GanttDependencyOverlay
          edges={edges}
          displayMode="focused"
          hoveredTaskId="a"
          clipLeftPx={0}
          resolveProjectId={() => "p"}
        />,
      );
      expect(lineCount(hovered.container)).toBe(1);

      const pinned = render(
        <GanttDependencyOverlay
          edges={edges}
          displayMode="focused"
          hoveredTaskId={null}
          pinnedTaskId="d"
          clipLeftPx={0}
          resolveProjectId={() => "p"}
        />,
      );
      expect(lineCount(pinned.container)).toBe(1);
    });

    it("critical draws only critical-path edges", () => {
      const { container } = render(
        <GanttDependencyOverlay
          edges={edges}
          displayMode="critical"
          criticalEdgeIds={new Set(["e2"])}
          hoveredTaskId={null}
          clipLeftPx={0}
          resolveProjectId={() => "p"}
        />,
      );
      // The critical edge plus its amber halo.
      expect(container.querySelectorAll("svg path[stroke]")).toHaveLength(2);
      expect(
        container.querySelector("svg path[stroke='var(--warning)']"),
      ).toBeTruthy();
    });

    it("hidden draws no connectors but still draws the link-drag preview", () => {
      const noPreview = render(
        <GanttDependencyOverlay
          edges={edges}
          displayMode="hidden"
          hoveredTaskId={null}
          clipLeftPx={0}
          resolveProjectId={() => "p"}
        />,
      );
      expect(noPreview.container.querySelector("svg")).toBeNull();

      const withPreview = render(
        <GanttDependencyOverlay
          edges={edges}
          displayMode="hidden"
          hoveredTaskId={null}
          clipLeftPx={0}
          resolveProjectId={() => "p"}
          preview={{ source: { x: 0, y: 0 }, pointer: { x: 5, y: 5 } }}
        />,
      );
      expect(
        withPreview.container.querySelector("[data-testid=gantt-link-preview]"),
      ).toBeTruthy();
      expect(
        withPreview.container.querySelectorAll("svg path[stroke]"),
      ).toHaveLength(1);
    });
  });
});
