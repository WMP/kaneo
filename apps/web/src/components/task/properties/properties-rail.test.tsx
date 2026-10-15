import { cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import type Task from "@/types/task";
import { PropertiesRail } from "./properties-rail";

const mocks = vi.hoisted(() => ({ properties: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/lib/i18n/domain", () => ({
  getPriorityLabel: (value: string) => value,
  getStatusDisplayLabel: (value: string) => value,
  getApprovalStatusLabel: (value: string) => `approval:${value}`,
}));
vi.mock("./use-task-properties", () => ({
  useTaskProperties: () => mocks.properties(),
}));
vi.mock("@/components/jira/jira-task-panel", () => ({
  JiraTaskPanel: (props: { taskId: string; projectId: string }) => (
    <div data-testid="jira-panel">{`${props.projectId}/${props.taskId}`}</div>
  ),
}));
vi.mock("../custom-fields/task-custom-field-rows", () => ({
  TaskCustomFieldRows: () => null,
}));
// The editing popovers have their own tests: here they only pass the trigger on.
vi.mock("../task-assignee-popover", () => ({
  default: (props: { children: React.ReactNode }) => <>{props.children}</>,
}));
vi.mock("../task-due-date-popover", () => ({
  default: (props: { children: React.ReactNode }) => <>{props.children}</>,
}));
vi.mock("../task-labels-popover", () => ({
  default: (props: { children: React.ReactNode }) => <>{props.children}</>,
}));
vi.mock("../task-move-popover", () => ({
  default: (props: { children: React.ReactNode }) => <>{props.children}</>,
}));
vi.mock("../task-priority-popover", () => ({
  default: (props: { children: React.ReactNode }) => <>{props.children}</>,
}));
vi.mock("../task-start-date-popover", () => ({
  default: (props: { children: React.ReactNode }) => <>{props.children}</>,
}));
vi.mock("../task-status-popover", () => ({
  default: (props: { children: React.ReactNode }) => <>{props.children}</>,
}));
vi.mock("../task-progress-popover", () => ({
  default: (props: { children: React.ReactNode }) => <>{props.children}</>,
}));
vi.mock("../task-estimate-popover", () => ({
  default: (props: { children: React.ReactNode }) => <>{props.children}</>,
}));
vi.mock("../task-milestone-popover", () => ({
  default: (props: { children: React.ReactNode }) => <>{props.children}</>,
}));
vi.mock("../task-baseline-popover", () => ({
  default: (props: { children: React.ReactNode }) => <>{props.children}</>,
}));
vi.mock("../task-constraint-popover", () => ({
  default: (props: { children: React.ReactNode }) => <>{props.children}</>,
}));
vi.mock("../task-approval-popover", () => ({
  default: (props: { children: React.ReactNode }) => <>{props.children}</>,
}));

const task = {
  id: "task-1",
  title: "Task",
  number: 1,
  description: null,
  status: "to-do",
  priority: "high",
  startDate: null,
  dueDate: null,
  progress: 40,
  isMilestone: true,
  estimateMinutes: 480,
  estimateUnit: "hours",
  baselineStartDate: null,
  baselineDueDate: null,
  constraintType: "start_no_earlier_than",
  approvalStatus: "pending",
  position: 1,
  createdAt: "2026-07-17T00:00:00.000Z",
  userId: "u1",
  assigneeId: "u1",
  assigneeName: "Alice",
  projectId: "project-1",
  assignees: [
    { userId: "u1", name: "Alice", image: null, units: 100, work: null },
    {
      userId: null,
      resourceId: "r1",
      kind: "equipment",
      name: "Drill",
      image: null,
      units: 100,
      work: null,
    },
  ],
} as unknown as Task;

function properties(can: {
  update: boolean;
  assign: boolean;
  labels: boolean;
}) {
  return {
    task,
    project: { name: "Project", icon: "Layout" },
    labels: [],
    status: { label: "To do", isFinal: false, icon: null },
    assignee: { userId: "u1", user: { name: "Alice", image: null } },
    dueStatus: "no-due-date",
    canMoveTask: false,
    can,
  };
}

function renderRail() {
  render(
    <PropertiesRail
      taskId="task-1"
      projectId="project-1"
      workspaceId="workspace-1"
    />,
  );
}

beforeEach(() => {
  mocks.properties.mockReturnValue(
    properties({ update: true, assign: true, labels: true }),
  );
});

afterEach(cleanup);

describe("PropertiesRail fork properties", () => {
  it("shows progress, estimate, milestone, constraint and approval of the task", () => {
    renderRail();

    expect(
      screen.getByRole("button", { name: "tasks:properties.progress" }),
    ).toHaveTextContent("40%");
    expect(
      screen.getByRole("button", { name: "tasks:properties.estimate" }),
    ).toHaveTextContent("tasks:estimate.valueHours");
    expect(
      screen.getByRole("button", { name: "tasks:properties.milestone" }),
    ).toHaveTextContent("tasks:properties.milestone");
    expect(
      screen.getByRole("button", { name: "tasks:properties.constraint" }),
    ).toHaveTextContent("tasks:popover.constraint.type.start_no_earlier_than");
    expect(
      screen.getByRole("button", { name: "tasks:properties.approval" }),
    ).toHaveTextContent("approval:pending");
    expect(
      screen.getByRole("button", { name: "tasks:properties.baseline" }),
    ).toHaveTextContent("tasks:popover.baseline.none");
  });

  it("shows every assignee, resources included, on the assignee value", () => {
    renderRail();

    expect(
      screen.getByRole("img", { name: "tasks:assignee.assignedAriaLabel" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("tasks:popover.assignee.assignedCount"),
    ).toBeTruthy();
  });

  it("renders the Jira panel for the task", () => {
    renderRail();

    expect(screen.getByTestId("jira-panel")).toHaveTextContent(
      "project-1/task-1",
    );
  });

  it("shows the values read-only when the project does not allow editing", () => {
    mocks.properties.mockReturnValue(
      properties({ update: false, assign: false, labels: false }),
    );
    renderRail();

    for (const name of [
      "tasks:properties.progress",
      "tasks:properties.estimate",
      "tasks:properties.milestone",
      "tasks:properties.baseline",
      "tasks:properties.constraint",
      "tasks:properties.approval",
    ]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(document.querySelector("[data-task-action=status]")).toBeDisabled();
    expect(
      document.querySelector("[data-task-action=assignee]"),
    ).toBeDisabled();
    expect(document.querySelector("[data-task-action=labels]")).toBeDisabled();
  });

  it("only blocks what the project role withholds", () => {
    mocks.properties.mockReturnValue(
      properties({ update: true, assign: false, labels: true }),
    );
    renderRail();

    expect(
      document.querySelector("[data-task-action=status]"),
    ).not.toBeDisabled();
    expect(
      document.querySelector("[data-task-action=assignee]"),
    ).toBeDisabled();
  });
});
