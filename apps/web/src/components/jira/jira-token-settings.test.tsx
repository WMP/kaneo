import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JiraRequestError } from "@/fetchers/jira-integration/jira-request-error";
import { JiraTokenSettings } from "./jira-token-settings";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key} ${Object.values(options).join(" ")}` : key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const m = vi.hoisted(() => ({
  connection: null as unknown,
  status: null as unknown,
  put: vi.fn(),
  remove: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/hooks/queries/jira-integration/use-get-jira-connection", () => ({
  default: () => ({ data: m.connection, isLoading: false }),
}));
vi.mock("@/hooks/queries/jira-integration/use-get-jira-token-status", () => ({
  default: () => ({ data: m.status, isLoading: false, error: null }),
}));
vi.mock("@/hooks/mutations/jira-integration/use-jira-token", () => ({
  usePutJiraToken: () => ({ mutateAsync: m.put, isPending: false }),
  useDeleteJiraToken: () => ({ mutateAsync: m.remove, isPending: false }),
}));

const connection = (deployment: "server" | "cloud", isActive = true) => ({
  id: "c1",
  workspaceId: "ws",
  baseUrl: "https://jira.example.com",
  deployment,
  isActive,
  pollingEnabled: true,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
});

const noToken = {
  connected: false,
  jiraAccountId: null,
  jiraUsername: null,
  jiraDisplayName: null,
  email: null,
  lastVerifiedAt: null,
  lastError: null,
};

const k = (name: string) => `settings:jiraIntegration.token.${name}`;

beforeEach(() => {
  m.put.mockReset();
  m.put.mockResolvedValue(noToken);
  m.status = noToken;
});
afterEach(cleanup);

describe("JiraTokenSettings", () => {
  it("asks only for the token on Server / Data Center and clears it after saving", async () => {
    m.connection = connection("server");
    render(<JiraTokenSettings workspaceId="ws" />);

    expect(screen.queryByText(k("emailLabel"))).toBeNull();
    const submit = screen.getByRole("button", { name: k("verifyAndSave") });
    expect(submit).toBeDisabled();

    const input = screen.getByLabelText(k("tokenLabelServer"));
    fireEvent.change(input, { target: { value: " secret-token " } });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(m.put).toHaveBeenCalledWith({
        workspaceId: "ws",
        data: { token: "secret-token" },
      }),
    );
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("needs the Atlassian email on Jira Cloud", async () => {
    m.connection = connection("cloud");
    render(<JiraTokenSettings workspaceId="ws" />);

    fireEvent.change(screen.getByLabelText(k("tokenLabelCloud")), {
      target: { value: "api-token" },
    });
    const submit = screen.getByRole("button", { name: k("verifyAndSave") });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(k("emailLabel")), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(m.put).toHaveBeenCalledWith({
        workspaceId: "ws",
        data: { token: "api-token", email: "ada@example.com" },
      }),
    );
  });

  it("shows a specific message for a rejected token and keeps what was typed", async () => {
    m.connection = connection("server");
    m.put.mockRejectedValue(
      new JiraRequestError(422, "Jira rejected the token.", {
        code: "JIRA_TOKEN_INVALID",
      }),
    );
    render(<JiraTokenSettings workspaceId="ws" />);

    const input = screen.getByLabelText(k("tokenLabelServer"));
    fireEvent.change(input, { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: k("verifyAndSave") }));

    expect(
      await screen.findByText("settings:jiraIntegration.errors.tokenInvalid"),
    ).toBeTruthy();
    expect(input).toHaveValue("bad");
  });

  it("shows the Jira identity, never a token, for a connected user", () => {
    m.connection = connection("server");
    m.status = {
      ...noToken,
      connected: true,
      jiraUsername: "ada",
      jiraDisplayName: "Ada Lovelace",
      lastVerifiedAt: "2026-09-30T08:00:00Z",
      lastError: "Jira rejected the token.",
    };
    render(<JiraTokenSettings workspaceId="ws" />);

    expect(screen.getByText(/Ada Lovelace/)).toBeTruthy();
    expect(
      screen.getByText(`${k("lastError")} Jira rejected the token.`),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: k("delete") })).toBeTruthy();
  });

  it("explains that the workspace has no active connection", () => {
    m.connection = null;
    render(<JiraTokenSettings workspaceId="ws" />);
    expect(screen.getByText(k("noConnectionTitle"))).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: k("verifyAndSave") }),
    ).toBeNull();
  });
});
