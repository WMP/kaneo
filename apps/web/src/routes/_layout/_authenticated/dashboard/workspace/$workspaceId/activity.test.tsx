import enUS from "@i18n/en-US.json";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./activity";

const routeParams = { workspaceId: "workspace-1" };

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    ...(options as Record<string, unknown>),
    useParams: () => routeParams,
  }),
  Link: ({
    children,
    to,
    ...props
  }: {
    children?: ReactNode;
    to: string;
    [key: string]: unknown;
  }) => (
    <a data-testid="task-link" href={to} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/page-title", () => ({ default: () => null }));

vi.mock("@/components/common/workspace-layout", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

vi.mock("@/components/activity", () => ({
  default: ({ activity }: { activity: { id: string; type: string } }) => (
    <div data-testid="activity-row">{`${activity.id}:${activity.type}`}</div>
  ),
}));

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
      if (typeof value !== "string") return key;
      if (!options) return value;
      return Object.entries(options).reduce(
        (result, [optionKey, optionValue]) =>
          result.replaceAll(`{{${optionKey}}}`, String(optionValue)),
        value,
      );
    },
  }),
}));

const useGetWorkspaceActivity = vi.fn();
vi.mock("@/hooks/queries/workspace/use-get-workspace-activity", () => ({
  default: (params: unknown) => useGetWorkspaceActivity(params),
}));

const useGetWorkspaceUsers = vi.fn();
vi.mock("@/hooks/queries/workspace-users/use-get-workspace-users", () => ({
  default: (params: unknown) => useGetWorkspaceUsers(params),
}));

const Component = (Route as unknown as { component: ComponentType }).component;

function activityRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "activity-1",
    taskId: "task-1",
    taskNumber: 12,
    taskTitle: "Fix the thing",
    projectId: "project-1",
    projectName: "Demo project",
    projectSlug: "DEM",
    type: "status_changed",
    createdAt: "2024-01-01T00:00:00Z",
    userId: "user-1",
    userName: "Ada",
    userImage: null,
    content: null,
    eventData: null,
    externalUserName: null,
    externalUserAvatar: null,
    externalSource: null,
    externalUrl: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useGetWorkspaceUsers.mockReturnValue({
    data: [{ user: { id: "user-1", name: "Ada", email: "ada@example.com" } }],
  });
});

afterEach(cleanup);

describe("workspace activity view", () => {
  it("shows a loading state while the first page is in flight", () => {
    useGetWorkspaceActivity.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
      isError: false,
    });

    render(<Component />);

    expect(screen.getByText("Activity")).toBeInTheDocument();
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows an error state when the request fails", () => {
    useGetWorkspaceActivity.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
    });

    render(<Component />);

    expect(
      screen.getByText("Failed to load workspace activity."),
    ).toBeInTheDocument();
  });

  it("shows the unfiltered empty state when there is no activity yet", () => {
    useGetWorkspaceActivity.mockReturnValue({
      data: {
        data: [],
        pagination: { total: 0, page: 1, pageSize: 25, totalPages: 1 },
      },
      isLoading: false,
      isFetching: false,
      isError: false,
    });

    render(<Component />);

    expect(screen.getByText("No activity yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Changes across every task in this workspace will show up here.",
      ),
    ).toBeInTheDocument();
  });

  it("shows a distinct empty state once a filter narrows the results to nothing", () => {
    useGetWorkspaceActivity.mockReturnValue({
      data: {
        data: [],
        pagination: { total: 0, page: 1, pageSize: 25, totalPages: 1 },
      },
      isLoading: false,
      isFetching: false,
      isError: false,
    });

    render(<Component />);

    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "comment" },
    });

    expect(screen.getByText("No matching activity")).toBeInTheDocument();
    expect(
      screen.getByText(
        "No activity matches these filters. Try widening the date range or clearing a filter.",
      ),
    ).toBeInTheDocument();
  });

  it("renders activity rows with a link to the source task and pagination controls", () => {
    useGetWorkspaceActivity.mockReturnValue({
      data: {
        data: [activityRow()],
        pagination: { total: 30, page: 1, pageSize: 25, totalPages: 2 },
      },
      isLoading: false,
      isFetching: false,
      isError: false,
    });

    render(<Component />);

    expect(screen.getByTestId("activity-row")).toHaveTextContent(
      "activity-1:status_changed",
    );
    const link = screen.getByTestId("task-link");
    expect(link).toHaveTextContent("DEM-12");
    expect(link).toHaveTextContent("Fix the thing");
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    const previousButton = screen.getByRole("button", { name: /Previous/ });
    const nextButton = screen.getByRole("button", { name: /Next/ });
    expect(previousButton).toBeDisabled();
    expect(nextButton).not.toBeDisabled();

    fireEvent.click(nextButton);

    const lastCall =
      useGetWorkspaceActivity.mock.calls[
        useGetWorkspaceActivity.mock.calls.length - 1
      ][0];
    expect(lastCall).toMatchObject({ page: 2 });
  });

  it("resets to page 1 and passes the chosen user through when the user filter changes", () => {
    useGetWorkspaceActivity.mockReturnValue({
      data: {
        data: [activityRow()],
        pagination: { total: 1, page: 1, pageSize: 25, totalPages: 1 },
      },
      isLoading: false,
      isFetching: false,
      isError: false,
    });

    render(<Component />);

    fireEvent.change(screen.getByLabelText("User"), {
      target: { value: "user-1" },
    });

    const lastCall =
      useGetWorkspaceActivity.mock.calls[
        useGetWorkspaceActivity.mock.calls.length - 1
      ][0];
    expect(lastCall).toMatchObject({ userId: "user-1", page: 1 });
  });
});
