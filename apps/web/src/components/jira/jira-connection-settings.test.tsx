import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JiraConnectionSettings } from "./jira-connection-settings";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const m = vi.hoisted(() => ({
  connection: null as unknown,
  save: vi.fn().mockResolvedValue(undefined),
  rotate: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/hooks/queries/jira-integration/use-get-jira-connection", () => ({
  default: () => ({ data: m.connection, isLoading: false, error: null }),
}));
vi.mock("@/hooks/mutations/jira-integration/use-jira-connection", () => ({
  usePutJiraConnection: () => ({ mutateAsync: m.save, isPending: false }),
  useRotateJiraWebhookSecret: () => ({
    mutateAsync: m.rotate,
    isPending: false,
  }),
  useDeleteJiraConnection: () => ({ mutateAsync: m.remove, isPending: false }),
}));

const base = {
  id: "c1",
  workspaceId: "ws",
  baseUrl: "https://jira.example.com",
  deployment: "server" as const,
  isActive: true,
  pollingEnabled: true,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
};

const k = (name: string) => `settings:jiraIntegration.connection.${name}`;

beforeEach(() => {
  m.save.mockClear();
  m.rotate.mockClear();
  m.remove.mockClear();
});
afterEach(cleanup);

describe("JiraConnectionSettings", () => {
  it("gives a member the read-only, non-secret part only", () => {
    m.connection = base;
    render(<JiraConnectionSettings workspaceId="ws" canManage={false} />);

    expect(screen.getByDisplayValue("https://jira.example.com")).toBeDisabled();
    expect(screen.queryByText(k("webhookTitle"))).toBeNull();
    expect(screen.queryByRole("button", { name: k("save") })).toBeNull();
    expect(screen.queryByRole("button", { name: k("delete") })).toBeNull();
  });

  it("shows the webhook secret masked until revealed, only when the API sent it", () => {
    m.connection = {
      ...base,
      webhookUrl:
        "https://kaneo.example.com/api/jira-integration/webhook/c1?secret=s3cret",
      webhookSecret: "s3cret",
    };
    render(<JiraConnectionSettings workspaceId="ws" canManage />);

    expect(screen.getByText(/webhook\/c1/)).toBeTruthy();
    expect(screen.queryByText("s3cret")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: k("showSecret") }));
    expect(screen.getByText("s3cret")).toBeTruthy();
  });

  it("rotates the secret only after confirmation", async () => {
    m.connection = {
      ...base,
      webhookUrl: "https://x/webhook",
      webhookSecret: "s",
    };
    render(<JiraConnectionSettings workspaceId="ws" canManage />);

    fireEvent.click(screen.getByRole("button", { name: k("rotate") }));
    expect(m.rotate).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole("button", { name: k("rotateConfirm") }),
    );
    await waitFor(() => expect(m.rotate).toHaveBeenCalledWith("ws"));
  });

  it("deletes the connection only after confirmation", async () => {
    m.connection = base;
    render(<JiraConnectionSettings workspaceId="ws" canManage />);

    fireEvent.click(screen.getByRole("button", { name: k("delete") }));
    expect(m.remove).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole("button", { name: k("deleteConfirm") }),
    );
    await waitFor(() => expect(m.remove).toHaveBeenCalledWith("ws"));
  });

  it("warns that a new base URL removes every stored token, then saves", async () => {
    m.connection = base;
    render(<JiraConnectionSettings workspaceId="ws" canManage />);

    expect(screen.queryByText(k("tokensRemovedWarning"))).toBeNull();
    fireEvent.change(screen.getByDisplayValue("https://jira.example.com"), {
      target: { value: "https://other.example.com" },
    });
    expect(screen.getByText(k("tokensRemovedWarning"))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: k("save") }));
    await waitFor(() =>
      expect(m.save).toHaveBeenCalledWith({
        workspaceId: "ws",
        data: {
          baseUrl: "https://other.example.com",
          deployment: "server",
          isActive: true,
          pollingEnabled: true,
        },
      }),
    );
  });
});
