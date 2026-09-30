import enUS from "@i18n/en-US.json";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Timeline } from "@/components/ui/timeline";
import Activity from "./index";

// Resolves against the real en-US bundle so assertions fail if a key this
// component references stops matching what actually ships.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const [namespace, path] = key.split(":");
      const source = (enUS as Record<string, unknown>)[namespace];
      const value = path
        .split(".")
        .reduce<unknown>(
          (acc, segment) =>
            acc && typeof acc === "object"
              ? (acc as Record<string, unknown>)[segment]
              : undefined,
          source,
        );
      const resolved =
        typeof value === "string"
          ? value
          : typeof options?.defaultValue === "string"
            ? options.defaultValue
            : key;
      if (!options) return resolved;
      return Object.entries(options).reduce(
        (result, [optionKey, optionValue]) =>
          result.replaceAll(`{{${optionKey}}}`, String(optionValue)),
        resolved,
      );
    },
  }),
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" } }),
}));

// Comments pull in the rich-text editor's extension chain (which touches the
// real i18n singleton at import time), and this suite only exercises
// system-event rendering, so keep it out of the module graph entirely.
vi.mock("./comment-card", () => ({
  default: () => null,
}));

// getConstraintTypeLabel (and its siblings) call the i18next singleton
// directly rather than the react-i18next hook mocked below, so it is mocked
// here too, matching the pattern already used by the gantt component tests.
vi.mock("@/lib/i18n/domain", () => ({
  getStatusLabel: (value: string) => value,
  getPriorityLabel: (value: string) => value,
  getApprovalStatusLabel: (value: string) => value,
  getConstraintTypeLabel: (value: string) => value,
}));

const useGetWorkspaceMembers = vi.fn();
vi.mock("@/hooks/queries/workspace/use-get-workspace-members", () => ({
  default: (params: unknown) => useGetWorkspaceMembers(params),
}));

vi.mock("@/lib/format", () => ({
  formatRelativeTime: () => "2 hours ago",
  formatDateMedium: (value: Date | string) => {
    const date = value instanceof Date ? value : new Date(value);
    return `FMT:${date.toISOString().slice(0, 10)}`;
  },
}));

afterEach(cleanup);

function baseActivity(overrides: Record<string, unknown> = {}) {
  return {
    id: "activity-1",
    type: "updated",
    content: null,
    eventData: null,
    createdAt: "2024-01-01T00:00:00Z",
    userId: null,
    taskId: "task-1",
    ...overrides,
  };
}

function renderActivity(activity: ReturnType<typeof baseActivity>) {
  return render(
    <Timeline>
      <Activity activity={activity} step={1} />
    </Timeline>,
  );
}

describe("Activity", () => {
  beforeEach(() => {
    useGetWorkspaceMembers.mockReturnValue({ data: [] });
  });

  it("renders a field-level before/after list for a schedule update", () => {
    renderActivity(
      baseActivity({
        eventData: {
          changes: {
            dueDate: { from: "2026-12-07", to: "2027-02-20" },
            progress: { from: 0, to: 33 },
            constraintType: { from: "none", to: "start_no_earlier_than" },
            constraintDate: { from: null, to: "2027-01-05" },
          },
        },
      }),
    );

    expect(screen.getByText("updated the plan")).toBeInTheDocument();
    expect(
      screen.getByText("Due date: FMT:2026-12-07 → FMT:2027-02-20"),
    ).toBeInTheDocument();
    expect(screen.getByText("Progress: 0% → 33%")).toBeInTheDocument();
    expect(
      screen.getByText("Constraint type: none → start_no_earlier_than"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Constraint date: — → FMT:2027-01-05"),
    ).toBeInTheDocument();
  });

  it("lists a boolean and unrecognized fields readably", () => {
    renderActivity(
      baseActivity({
        eventData: {
          changes: {
            isMilestone: { from: false, to: true },
            somethingNew: { from: "a", to: "b" },
          },
        },
      }),
    );

    expect(screen.getByText("Milestone: False → True")).toBeInTheDocument();
    expect(screen.getByText("Somethingnew: a → b")).toBeInTheDocument();
  });

  it("falls back to the generic message when there is no changes payload", () => {
    renderActivity(baseActivity({ eventData: null }));

    expect(screen.getByText("updated the plan")).toBeInTheDocument();
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  });

  it("falls back to the generic message when changes is an empty object", () => {
    renderActivity(baseActivity({ eventData: { changes: {} } }));

    expect(screen.getByText("updated the plan")).toBeInTheDocument();
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  });
  it.each([
    ["jira_issue_created", "created the Jira issue"],
    ["jira_issue_updated", "updated the Jira issue"],
    ["jira_issue_unlinked", "unlinked the Jira issue"],
  ])("renders %s with the issue key linked to Jira", (type, text) => {
    renderActivity(
      baseActivity({
        type,
        userId: "user-1",
        eventData: {
          issueKey: "PROJ-7",
          issueUrl: "https://jira.example.com/browse/PROJ-7",
        },
      }),
    );

    expect(screen.getByText(text, { exact: false })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "PROJ-7" });
    expect(link).toHaveAttribute(
      "href",
      "https://jira.example.com/browse/PROJ-7",
    );
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("shows the Jira issue key as text when its URL is not a web URL", () => {
    renderActivity(
      baseActivity({
        type: "jira_issue_created",
        eventData: { issueKey: "PROJ-7", issueUrl: "javascript:alert(1)" },
      }),
    );

    expect(screen.getByText("PROJ-7")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders a status change seen in Jira, attributed to Jira", () => {
    renderActivity(
      baseActivity({
        type: "jira_status_changed",
        content: "Jira status changed from In Progress to Done",
        eventData: {
          issueKey: "PROJ-7",
          fromStatus: "In Progress",
          toStatus: "Done",
          proposedStatus: "done",
        },
      }),
    );

    expect(screen.getByText("Jira")).toBeInTheDocument();
    expect(
      screen.getByText("changed the status of PROJ-7 from In Progress to Done"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Someone")).not.toBeInTheDocument();
  });

  it("renders a first status seen in Jira without a previous one", () => {
    renderActivity(
      baseActivity({
        type: "jira_status_changed",
        eventData: { issueKey: "PROJ-7", fromStatus: null, toStatus: "Done" },
      }),
    );

    expect(
      screen.getByText("changed the status of PROJ-7 to Done"),
    ).toBeInTheDocument();
  });

  it("falls back to the stored text for a Jira activity without event data", () => {
    renderActivity(
      baseActivity({
        type: "jira_status_changed",
        content: "Jira status changed from A to B",
        eventData: null,
      }),
    );

    expect(
      screen.getByText("Jira status changed from A to B"),
    ).toBeInTheDocument();
  });
});
