import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JiraRequestError } from "@/fetchers/jira-integration/jira-request-error";
import type { JiraDraft } from "@/fetchers/jira-integration/types";
import { SendToJiraDialog } from "./send-to-jira-dialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key} ${Object.values(options).join(" ")}` : key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

const m = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  draft: null as unknown,
  draftCalls: [] as unknown[],
  send: vi.fn(),
  projects: undefined as unknown,
  issueTypes: undefined as unknown,
}));

vi.mock("@/lib/toast", () => ({ toast: m.toast }));
vi.mock("@/hooks/queries/jira-integration/use-get-jira-draft", () => ({
  default: (_taskId: string, params: unknown) => {
    m.draftCalls.push(params);
    return {
      data: m.draft,
      isPending: false,
      isPlaceholderData: false,
      error: null,
      refetch: vi.fn(),
    };
  },
}));
vi.mock("@/hooks/queries/jira-integration/use-get-jira-meta", () => ({
  useJiraProjects: () => ({ data: m.projects }),
  useJiraIssueTypes: () => ({ data: m.issueTypes }),
}));
vi.mock("@/hooks/mutations/jira-integration/use-jira-task", () => ({
  useSendTaskToJira: () => ({ mutateAsync: m.send, isPending: false }),
}));
// The Select popup cannot be driven in jsdom; a native select has the same
// contract (value, options, change).
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
vi.mock("./jira-user-field", () => ({
  JiraUserField: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <input
      aria-label="jira-user"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const k = (name: string) => `tasks:jira.send.${name}`;

function makeDraft(overrides: Partial<JiraDraft> = {}): JiraDraft {
  return {
    taskId: "t1",
    connection: {
      id: "c1",
      baseUrl: "https://jira.example.com",
      deployment: "server",
    },
    tokenConnected: true,
    target: {
      jiraProjectKey: { value: "PROJ", origin: "workspace" },
      issueTypeId: { value: "10001", origin: "workspace" },
      issueTypeName: { value: "Task", origin: "workspace" },
    },
    link: null,
    fields: [
      {
        fieldId: "summary",
        fieldName: "Summary",
        type: "string",
        value: "Fix login",
        jiraValue: "Fix login",
        origin: "task",
        mappingOrigin: "default",
        required: true,
      },
      {
        fieldId: "description",
        fieldName: "Description",
        type: "text",
        value: null,
        jiraValue: null,
        origin: "empty",
        mappingOrigin: "default",
      },
      {
        fieldId: "priority",
        fieldName: "Priority",
        type: "priority",
        value: "urgent",
        jiraValue: { name: "Highest" },
        origin: "task",
        mappingOrigin: "workspace",
        allowedValues: [{ name: "Highest" }, { name: "High" }],
      },
      {
        fieldId: "labels",
        fieldName: "Labels",
        type: "labels",
        value: ["web"],
        jiraValue: ["web"],
        origin: "task",
        mappingOrigin: "default",
      },
      {
        fieldId: "customfield_10010",
        fieldName: "Team",
        type: "string",
        value: null,
        jiraValue: null,
        origin: "empty",
        mappingOrigin: "project",
        required: true,
      },
    ],
    missingRequired: [],
    warnings: [],
    createMeta: { jiraProjectKey: "PROJ", issueTypeId: "10001" },
    ...overrides,
  };
}

const onOpenChange = vi.fn();

function setup() {
  return render(
    <SendToJiraDialog
      open
      onOpenChange={onOpenChange}
      taskId="t1"
      workspaceId="ws"
    />,
  );
}

const row = (fieldId: string) =>
  document.querySelector<HTMLElement>(
    `[data-field-id="${fieldId}"]`,
  ) as HTMLElement;
const sendButton = () => screen.getByRole("button", { name: k("submit") });

beforeEach(() => {
  m.draft = makeDraft();
  m.draftCalls = [];
  m.projects = undefined;
  m.issueTypes = undefined;
  m.send.mockReset();
  m.send.mockResolvedValue({
    created: true,
    link: {
      issueKey: "PROJ-7",
      issueUrl: "https://jira.example.com/browse/PROJ-7",
    },
    warnings: [],
  });
  onOpenChange.mockReset();
  for (const fn of Object.values(m.toast)) fn.mockReset();
});
afterEach(cleanup);

describe("SendToJiraDialog rows", () => {
  it("shows every draft field with its Jira id, origin badge and required marker", () => {
    setup();

    const summary = row("summary");
    expect(within(summary).getByText("Summary")).toBeInTheDocument();
    expect(within(summary).getByText("summary")).toBeInTheDocument();
    expect(summary.querySelector("[data-draft-origin]")).toHaveAttribute(
      "data-draft-origin",
      "task",
    );
    expect(within(summary).getByText("tasks:jira.send.required")).toBeTruthy();
    expect(within(summary).getByLabelText("Summary")).toHaveValue("Fix login");

    expect(
      row("description").querySelector("[data-draft-origin]"),
    ).toHaveAttribute("data-draft-origin", "empty");
    expect(
      within(row("description")).queryByText("tasks:jira.send.required"),
    ).toBeNull();

    // The unedited priority reads as the Jira value it will become.
    expect(within(row("priority")).getByLabelText("Priority")).toHaveValue(
      "Highest",
    );
    expect(within(row("labels")).getByText("web")).toBeInTheDocument();
  });

  it("marks a default-valued row with the default badge", () => {
    m.draft = makeDraft({
      fields: [
        {
          fieldId: "components",
          fieldName: "Components",
          type: "components",
          value: ["Web"],
          jiraValue: [{ name: "Web" }],
          origin: "default",
          mappingOrigin: "workspace",
        },
      ],
    });
    setup();
    expect(
      row("components").querySelector("[data-draft-origin]"),
    ).toHaveAttribute("data-draft-origin", "default");
  });

  it("shows the API's warnings and required fields that have no mapping", () => {
    m.draft = makeDraft({
      warnings: [
        { code: "JIRA_REQUEST_FAILED", message: "Jira is down" },
        { code: "JIRA_TOKEN_MISSING", message: "Token missing" },
      ],
      missingRequired: [
        { fieldId: "customfield_9", name: "Severity", mapped: false },
        { fieldId: "customfield_10010", name: "Team", mapped: true },
      ],
    });
    setup();

    const warnings = screen.getByTestId("jira-warnings");
    expect(within(warnings).getByText("Jira is down")).toBeInTheDocument();
    // A connected caller is not told about a missing token.
    expect(screen.queryByText("Token missing")).toBeNull();
    const unmapped = screen.getByTestId("jira-unmapped-alert");
    expect(unmapped).toHaveTextContent("Severity");
    expect(unmapped).not.toHaveTextContent("Team");
  });

  it("points to the account Jira page when the caller has no token", () => {
    m.draft = makeDraft({ tokenConnected: false });
    setup();

    expect(screen.getByText(k("noToken.description"))).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: k("noToken.link") }),
    ).toHaveAttribute("href", "/dashboard/settings/account/jira");
    expect(screen.queryByRole("button", { name: k("submit") })).toBeNull();
    expect(screen.queryByLabelText("Summary")).toBeNull();
  });
});

describe("SendToJiraDialog required fields", () => {
  it("blocks Send while a required field is empty and lists it", () => {
    setup();

    expect(sendButton()).toBeDisabled();
    expect(screen.getByTestId("jira-required-alert")).toHaveTextContent("Team");

    fireEvent.change(within(row("customfield_10010")).getByLabelText("Team"), {
      target: { value: "Core" },
    });

    expect(sendButton()).toBeEnabled();
    expect(screen.queryByTestId("jira-required-alert")).toBeNull();
  });

  it("does not block an update of a linked issue and omits project and issue type", async () => {
    m.draft = makeDraft({
      link: {
        id: "l1",
        taskId: "t1",
        issueId: "100",
        issueKey: "PROJ-1",
        issueUrl: "https://jira.example.com/browse/PROJ-1",
        jiraProjectKey: "PROJ",
        lastStatusId: null,
        lastStatusName: null,
        lastSyncedAt: null,
        syncError: null,
        createdByUserId: "u1",
        createdAt: "2026-09-01T00:00:00Z",
        updatedAt: "2026-09-01T00:00:00Z",
      },
    });
    setup();

    expect(screen.queryByLabelText(k("project"))).toBeNull();
    const update = screen.getByRole("button", { name: k("submitUpdate") });
    expect(update).toBeEnabled();
    fireEvent.click(update);

    await waitFor(() => expect(m.send).toHaveBeenCalledTimes(1));
    const body = m.send.mock.calls[0][0].data;
    expect(body).not.toHaveProperty("jiraProjectKey");
    expect(body).not.toHaveProperty("issueTypeId");
  });
});

describe("SendToJiraDialog sending", () => {
  it("sends the edited values with the target and closes with a link toast", async () => {
    setup();

    fireEvent.change(within(row("summary")).getByLabelText("Summary"), {
      target: { value: "Fix the login form" },
    });
    fireEvent.change(within(row("customfield_10010")).getByLabelText("Team"), {
      target: { value: "Core" },
    });
    fireEvent.change(within(row("priority")).getByLabelText("Priority"), {
      target: { value: "High" },
    });
    const labels = within(row("labels")).getByLabelText("Labels");
    fireEvent.change(labels, { target: { value: "urgent-fix" } });
    fireEvent.keyDown(labels, { key: "Enter" });

    fireEvent.click(sendButton());

    await waitFor(() => expect(m.send).toHaveBeenCalledTimes(1));
    expect(m.send).toHaveBeenCalledWith({
      taskId: "t1",
      data: {
        jiraProjectKey: "PROJ",
        issueTypeId: "10001",
        fields: [
          { fieldId: "summary", type: "string", value: "Fix the login form" },
          { fieldId: "description", type: "text", value: null },
          { fieldId: "priority", type: "priority", value: "High" },
          { fieldId: "labels", type: "labels", value: ["web", "urgent-fix"] },
          { fieldId: "customfield_10010", type: "string", value: "Core" },
        ],
      },
    });

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(m.toast.success).toHaveBeenCalledTimes(1);
    const [message, options] = m.toast.success.mock.calls[0];
    expect(message).toContain("tasks:jira.send.createdToast");
    expect(options.action.label).toBe("PROJ-7");
  });

  it("sends an untouched row as the draft produced it", async () => {
    setup();
    fireEvent.change(within(row("customfield_10010")).getByLabelText("Team"), {
      target: { value: "Core" },
    });
    fireEvent.click(sendButton());

    await waitFor(() => expect(m.send).toHaveBeenCalledTimes(1));
    const fields = m.send.mock.calls[0][0].data.fields;
    // The server applies the mapping's value map to the Kaneo value.
    expect(fields).toContainEqual({
      fieldId: "priority",
      type: "priority",
      value: "urgent",
    });
  });

  it("re-reads the draft for another issue type and keeps the edited values", () => {
    setup();
    expect(m.draftCalls.at(-1)).toEqual({});

    fireEvent.change(within(row("summary")).getByLabelText("Summary"), {
      target: { value: "Edited title" },
    });
    const issueType = screen.getByLabelText(k("issueType"));
    fireEvent.change(issueType, { target: { value: "10002" } });
    fireEvent.blur(issueType);

    expect(m.draftCalls.at(-1)).toEqual({
      jiraProjectKey: "PROJ",
      issueTypeId: "10002",
    });
    expect(within(row("summary")).getByLabelText("Summary")).toHaveValue(
      "Edited title",
    );
  });

  it("waits for an issue type after another project is picked", () => {
    m.projects = {
      projects: [
        { id: "1", key: "PROJ", name: "Project" },
        { id: "2", key: "OPS", name: "Operations" },
      ],
    };
    m.issueTypes = { issueTypes: [{ id: "10001", name: "Task" }] };
    setup();

    fireEvent.change(screen.getByLabelText(k("project")), {
      target: { value: "OPS" },
    });

    // Both parts are needed to read another target's create metadata.
    expect(m.draftCalls.at(-1)).toEqual({});
    expect(sendButton()).toBeDisabled();
  });
});

describe("SendToJiraDialog errors", () => {
  function failWith(error: Error) {
    m.send.mockRejectedValue(error);
    setup();
    fireEvent.change(within(row("customfield_10010")).getByLabelText("Team"), {
      target: { value: "Core" },
    });
    fireEvent.click(sendButton());
  }

  it("shows Jira's message under the field it is about and the rest in the alert", async () => {
    failWith(
      new JiraRequestError(502, "Jira failed", {
        code: "JIRA_REQUEST_FAILED",
        errors: { summary: "Summary is too long", labels: "" },
        errorMessages: ["Issue type is not allowed"],
        jiraStatus: 400,
      }),
    );

    await waitFor(() =>
      expect(
        within(row("summary")).getByText("Summary is too long"),
      ).toBeInTheDocument(),
    );
    expect(within(row("summary")).getByLabelText("Summary")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    const alert = screen
      .getAllByRole("alert")
      .find((node) => node.textContent?.includes("errors.requestFailed"));
    expect(alert).toHaveTextContent("Issue type is not allowed");
    // Said once, under the row.
    expect(alert).not.toHaveTextContent("Summary is too long");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("keeps Jira's message about a field that has no row in the alert", async () => {
    failWith(
      new JiraRequestError(502, "Jira failed", {
        code: "JIRA_REQUEST_FAILED",
        errors: { customfield_99999: "Severity is required" },
      }),
    );

    await waitFor(() =>
      expect(screen.getByText(/Severity is required/)).toBeInTheDocument(),
    );
  });

  it.each([
    ["JIRA_ISSUE_ALREADY_LINKED", "issueAlreadyLinked", 409],
    ["JIRA_TOKEN_MISSING", "tokenMissing", 409],
    ["JIRA_TOKEN_INVALID", "tokenInvalid", 422],
  ])("explains %s", async (code, key, status) => {
    failWith(new JiraRequestError(status, "x", { code }));
    await waitFor(() =>
      expect(
        screen.getByText(`settings:jiraIntegration.errors.${key}`),
      ).toBeInTheDocument(),
    );
    expect(m.toast.success).not.toHaveBeenCalled();
  });

  it("clears a field's message once the field is edited", async () => {
    failWith(
      new JiraRequestError(502, "Jira failed", {
        code: "JIRA_REQUEST_FAILED",
        errors: { summary: "Summary is too long" },
      }),
    );
    await screen.findByText("Summary is too long");

    fireEvent.change(within(row("summary")).getByLabelText("Summary"), {
      target: { value: "Short" },
    });
    expect(screen.queryByText("Summary is too long")).toBeNull();
  });
});
