import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DependencyEdgeGeometry } from "./dependency-lines";
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
            typeLabelPoint: { x: 1, y: 1 },
          }),
          edge({
            id: "cross",
            sourceTaskId: "external-task",
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
});
