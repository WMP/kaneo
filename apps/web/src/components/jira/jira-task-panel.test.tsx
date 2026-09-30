import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  JiraStatusProposal,
  JiraTaskInfo,
} from "@/fetchers/jira-integration/types";
import { JiraTaskPanel } from "./jira-task-panel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key} ${Object.values(options).join(" ")}` : key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@/lib/i18n/domain", () => ({
  getStatusDisplayLabel: (slug: string, name?: string) => name ?? slug,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

const m = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  connection: { isActive: true } as unknown,
  info: null as unknown,
  token: { connected: true } as unknown,
  canUpdate: true,
  refresh: vi.fn(),
  unlink: vi.fn(),
  accept: vi.fn(),
  reject: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({ toast: m.toast }));
vi.mock("@/hooks/queries/jira-integration/use-get-jira-connection", () => ({
  default: () => ({ data: m.connection }),
}));
vi.mock("@/hooks/queries/jira-integration/use-get-jira-task", () => ({
  default: () => ({ data: m.info }),
}));
vi.mock("@/hooks/queries/jira-integration/use-get-jira-token-status", () => ({
  default: () => ({ data: m.token }),
}));
vi.mock("@/hooks/queries/column/use-get-columns", () => ({
  useGetColumns: () => ({
    data: [
      { slug: "to-do", name: "To Do" },
      { slug: "in-review", name: "In Review" },
      { slug: "done", name: "Done" },
    ],
  }),
}));
vi.mock("@/hooks/queries/project-member/use-project-members", () => ({
  useProjectMembers: () => ({
    data: { members: [{ userId: "u1", user: { name: "Ada Lovelace" } }] },
  }),
}));
vi.mock("@/hooks/use-project-permission", () => ({
  useProjectPermission: () => ({ canUpdateTasks: () => m.canUpdate }),
}));
vi.mock("@/hooks/mutations/jira-integration/use-jira-task", () => ({
  useRefreshJiraTask: () => ({ mutateAsync: m.refresh, isPending: false }),
  useUnlinkJiraTask: () => ({ mutateAsync: m.unlink, isPending: false }),
  useAcceptJiraProposal: () => ({ mutateAsync: m.accept, isPending: false }),
  useRejectJiraProposal: () => ({ mutateAsync: m.reject, isPending: false }),
}));
vi.mock("./mapping-controls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mapping-controls")>();
  return {
    ...actual,
    SimpleSelect: ({
      value,
      onChange,
      options,
      ariaLabel,
    }: {
      value: string | null | undefined;
      onChange: (value: string) => void;
      options: { value: string; label: string }[];
      ariaLabel: string;
    }) => (
      <select
        aria-label={ariaLabel}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="" />
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ),
  };
});

const k = (name: string) => `tasks:jira.panel.${name}`;

function proposal(overrides: Partial<JiraStatusProposal> = {}) {
  return {
    id: "p1",
    taskId: "t1",
    linkId: "l1",
    fromStatusName: "In Progress",
    toStatusId: "3",
    toStatusName: "Code Review",
    proposedStatus: "in-review",
    state: "pending",
    jiraChangedBy: "jsmith",
    jiraChangedAt: null,
    source: "webhook",
    resolvedByUserId: null,
    resolvedStatus: null,
    resolvedAt: null,
    createdAt: "2026-09-30T08:00:00Z",
    ...overrides,
  } as JiraStatusProposal;
}

function makeInfo(overrides: Partial<JiraTaskInfo> = {}): JiraTaskInfo {
  return {
    link: {
      id: "l1",
      taskId: "t1",
      issueId: "100",
      issueKey: "PROJ-12",
      issueUrl: "https://jira.example.com/browse/PROJ-12",
      jiraProjectKey: "PROJ",
      lastStatusId: "3",
      lastStatusName: "In Progress",
      lastSyncedAt: "2026-09-30T08:00:00Z",
      syncError: null,
      createdByUserId: "u1",
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-30T08:00:00Z",
    },
    pendingProposal: null,
    proposals: [],
    sync: { pollingEnabled: true, creatorTokenState: "ok" },
    ...overrides,
  };
}

function setup() {
  return render(<JiraTaskPanel taskId="t1" projectId="p1" workspaceId="ws" />);
}

beforeEach(() => {
  m.connection = { isActive: true };
  m.info = makeInfo();
  m.token = { connected: true };
  m.canUpdate = true;
  m.refresh.mockReset().mockResolvedValue({ changed: false, info: makeInfo() });
  m.unlink.mockReset().mockResolvedValue({ success: true });
  m.accept.mockReset().mockResolvedValue({ proposal: proposal() });
  m.reject.mockReset().mockResolvedValue({ proposal: proposal() });
  for (const fn of Object.values(m.toast)) fn.mockReset();
});
afterEach(cleanup);

describe("JiraTaskPanel visibility", () => {
  it("renders nothing for a task without a link or history", () => {
    m.info = makeInfo({ link: null });
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing without an active connection", () => {
    m.connection = { isActive: false };
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });
});

describe("JiraTaskPanel linked issue", () => {
  it("links the issue safely and shows the status and last sync", () => {
    setup();

    const link = screen.getByRole("link", { name: /PROJ-12/ });
    expect(link).toHaveAttribute(
      "href",
      "https://jira.example.com/browse/PROJ-12",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.queryByText(k("neverSynced"))).toBeNull();
    expect(screen.queryByTestId("jira-sync-hint")).toBeNull();
  });

  it("does not link an issue URL that is not a web URL", () => {
    m.info = makeInfo({
      link: { ...makeInfo().link, issueUrl: "javascript:alert(1)" } as never,
    });
    setup();
    expect(screen.queryByRole("link", { name: /PROJ-12/ })).toBeNull();
    expect(screen.getByText("PROJ-12")).toBeInTheDocument();
  });

  it("explains why polling is off for this task", () => {
    m.info = makeInfo({
      sync: { pollingEnabled: true, creatorTokenState: "missing" },
    });
    setup();
    expect(screen.getByTestId("jira-sync-hint")).toHaveTextContent(
      k("sync.creatorTokenMissing"),
    );
  });

  it("explains that polling is off for the workspace", () => {
    m.info = makeInfo({
      sync: { pollingEnabled: false, creatorTokenState: "ok" },
    });
    setup();
    expect(screen.getByTestId("jira-sync-hint")).toHaveTextContent(
      k("sync.pollingOff"),
    );
  });

  it("refreshes with the caller's token and reports a change", async () => {
    m.refresh.mockResolvedValue({ changed: true, info: makeInfo() });
    setup();

    fireEvent.click(screen.getByRole("button", { name: k("refresh") }));

    await waitFor(() => expect(m.refresh).toHaveBeenCalledWith("t1"));
    await waitFor(() =>
      expect(m.toast.info).toHaveBeenCalledWith(k("refreshChanged")),
    );
  });

  it("needs a token to refresh and points to the account page", () => {
    m.token = { connected: false };
    setup();

    expect(screen.getByRole("button", { name: k("refresh") })).toBeDisabled();
    expect(screen.getByRole("link", { name: k("tokenLink") })).toHaveAttribute(
      "href",
      "/dashboard/settings/account/jira",
    );
  });

  it("unlinks only after a confirmation", async () => {
    setup();

    fireEvent.click(screen.getByRole("button", { name: k("unlink") }));
    expect(m.unlink).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: k("unlinkConfirm") }),
    );
    await waitFor(() => expect(m.unlink).toHaveBeenCalledWith("t1"));
  });
});

describe("JiraTaskPanel pending proposal", () => {
  it("shows the change and the proposed status, and accepts it as proposed", async () => {
    m.info = makeInfo({ pendingProposal: proposal() });
    setup();

    const card = screen.getByTestId("jira-proposal");
    expect(card).toHaveTextContent("In Progress");
    expect(card).toHaveTextContent("Code Review");
    expect(card).toHaveTextContent("In Review");
    // A mapped proposal needs no choice.
    expect(within(card).queryByRole("combobox")).toBeNull();

    fireEvent.click(
      within(card).getByRole("button", {
        name: "tasks:jira.panel.proposal.accept",
      }),
    );
    await waitFor(() =>
      expect(m.accept).toHaveBeenCalledWith({
        proposalId: "p1",
        taskId: "t1",
        projectId: "p1",
        status: undefined,
      }),
    );
  });

  it("requires a status before accepting a proposal that is not mapped", async () => {
    m.info = makeInfo({
      pendingProposal: proposal({ proposedStatus: null }),
    });
    setup();

    const card = screen.getByTestId("jira-proposal");
    const accept = within(card).getByRole("button", {
      name: "tasks:jira.panel.proposal.accept",
    });
    expect(accept).toBeDisabled();

    fireEvent.change(
      within(card).getByLabelText("tasks:jira.panel.proposal.chooseLabel"),
      { target: { value: "done" } },
    );
    expect(accept).toBeEnabled();
    fireEvent.click(accept);

    await waitFor(() =>
      expect(m.accept).toHaveBeenCalledWith({
        proposalId: "p1",
        taskId: "t1",
        projectId: "p1",
        status: "done",
      }),
    );
  });

  it("rejects a proposal", async () => {
    m.info = makeInfo({ pendingProposal: proposal() });
    setup();

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:jira.panel.proposal.reject" }),
    );
    await waitFor(() =>
      expect(m.reject).toHaveBeenCalledWith({
        proposalId: "p1",
        taskId: "t1",
      }),
    );
  });

  it("hides Accept, Reject and Unlink without task:update", () => {
    m.canUpdate = false;
    m.info = makeInfo({ pendingProposal: proposal() });
    setup();

    expect(
      screen.queryByRole("button", {
        name: "tasks:jira.panel.proposal.accept",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "tasks:jira.panel.proposal.reject",
      }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: k("unlink") })).toBeNull();
    expect(
      screen.getByText("tasks:jira.panel.proposal.waiting"),
    ).toBeInTheDocument();
    // Reading the status is for everybody with a token.
    expect(screen.getByRole("button", { name: k("refresh") })).toBeEnabled();
  });

  it("explains a proposal someone else already resolved", async () => {
    m.info = makeInfo({ pendingProposal: proposal() });
    const { JiraRequestError } = await import(
      "@/fetchers/jira-integration/jira-request-error"
    );
    m.accept.mockRejectedValue(
      new JiraRequestError(409, "x", { code: "PROPOSAL_NOT_PENDING" }),
    );
    setup();

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:jira.panel.proposal.accept" }),
    );
    await waitFor(() =>
      expect(m.toast.error).toHaveBeenCalledWith(
        "settings:jiraIntegration.errors.proposalNotPending",
      ),
    );
  });
});

describe("JiraTaskPanel history", () => {
  it("lists earlier proposals with their state and who resolved them", () => {
    m.info = makeInfo({
      pendingProposal: proposal(),
      proposals: [
        proposal(),
        proposal({
          id: "p0",
          state: "accepted",
          fromStatusName: "To Do",
          toStatusName: "In Progress",
          resolvedByUserId: "u1",
          resolvedStatus: "in-review",
        }),
        proposal({
          id: "pm1",
          state: "rejected",
          toStatusName: "Blocked",
          resolvedByUserId: "unknown-user",
        }),
        proposal({ id: "pm2", state: "superseded", toStatusName: "QA" }),
      ],
    });
    setup();

    fireEvent.click(screen.getByRole("button", { name: /history\.title/ }));

    const entries = screen.getAllByTestId("jira-history-entry");
    // The pending proposal is the card above, not a history row.
    expect(entries).toHaveLength(3);
    expect(entries[0]).toHaveTextContent("To Do → In Progress");
    expect(entries[0]).toHaveTextContent("history.state.accepted");
    expect(entries[0]).toHaveTextContent("Ada Lovelace");
    expect(entries[0]).toHaveTextContent("In Review");
    expect(entries[1]).toHaveTextContent("history.state.rejected");
    expect(entries[1]).toHaveTextContent("common:people.someone");
    expect(entries[2]).toHaveTextContent("history.state.superseded");
  });
});
