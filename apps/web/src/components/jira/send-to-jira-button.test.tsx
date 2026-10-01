import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SendToJiraButton } from "./send-to-jira-button";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const m = vi.hoisted(() => ({
  connection: null as unknown,
  info: null as unknown,
  canUpdate: true,
  checking: false,
}));

vi.mock("@/hooks/queries/jira-integration/use-get-jira-connection", () => ({
  default: () => ({ data: m.connection }),
}));
vi.mock("@/hooks/queries/jira-integration/use-get-jira-task", () => ({
  default: () => ({ data: m.info }),
}));
vi.mock("@/hooks/use-project-permission", () => ({
  useProjectPermission: () => ({
    canUpdateTasks: () => m.canUpdate,
    isCheckingPermissions: m.checking,
  }),
}));
vi.mock("./send-to-jira-dialog", () => ({
  SendToJiraDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="send-dialog" /> : null,
}));

beforeEach(() => {
  m.connection = { isActive: true };
  m.info = { link: null };
  m.canUpdate = true;
  m.checking = false;
});
afterEach(cleanup);

function setup() {
  return render(
    <SendToJiraButton taskId="t1" projectId="p1" workspaceId="ws" />,
  );
}

describe("SendToJiraButton", () => {
  it("renders nothing without a Jira connection", () => {
    m.connection = null;
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while the connection is turned off", () => {
    m.connection = { isActive: false };
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });

  it("offers to send an unlinked task and opens the dialog", () => {
    setup();
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:jira.button.send" }),
    );
    expect(screen.getByTestId("send-dialog")).toBeInTheDocument();
  });

  it("offers to update a linked task", () => {
    m.info = { link: { issueKey: "PROJ-1" } };
    setup();
    expect(
      screen.getByRole("button", { name: "tasks:jira.button.update" }),
    ).toBeInTheDocument();
  });

  it("is disabled and opens nothing without task:update", () => {
    m.canUpdate = false;
    setup();
    const button = screen.getByRole("button", {
      name: "tasks:jira.button.send",
    });
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(screen.queryByTestId("send-dialog")).toBeNull();
  });
});
