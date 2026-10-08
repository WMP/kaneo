import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TaskDetailsSheet from "./task-details-sheet";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("@/hooks/queries/task/use-get-task", () => ({
  default: () => ({ data: { number: 7 } }),
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({ data: { slug: "AFB" } }),
}));
vi.mock("@/components/jira/send-to-jira-button", () => ({
  SendToJiraButton: () => null,
}));
vi.mock("./task-delete-button", () => ({ default: () => null }));
vi.mock("./task-details-content", () => ({ default: () => null }));
vi.mock("./task-properties-sidebar", () => ({ default: () => null }));

afterEach(cleanup);

function renderSheet(onClose = vi.fn(), withAside = true) {
  render(
    <TaskDetailsSheet
      taskId="task-1"
      projectId="project-1"
      workspaceId="workspace-1"
      onClose={onClose}
      backdropAside={
        withAside ? (
          <div data-testid="aside">
            <button type="button">inside aside</button>
          </div>
        ) : undefined
      }
    />,
  );
  return onClose;
}

describe("TaskDetailsSheet backdropAside", () => {
  it("renders the aside inside the sheet popup so it shares the focus trap", () => {
    renderSheet();
    const popup = document.querySelector("[data-slot=sheet-popup]");
    expect(popup).not.toBeNull();
    expect(popup).toContainElement(screen.getByTestId("aside"));
  });

  it("does not close the sheet when the aside is pressed", () => {
    const onClose = renderSheet();
    const button = screen.getByRole("button", { name: "inside aside" });
    fireEvent.pointerDown(button);
    fireEvent.mouseDown(button);
    fireEvent.click(button);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("still closes the sheet when the blurred area outside the aside is pressed", () => {
    const onClose = renderSheet();
    const viewport = document.querySelector("[data-slot=sheet-viewport]");
    expect(viewport).not.toBeNull();
    fireEvent.pointerDown(viewport as Element);
    fireEvent.mouseDown(viewport as Element);
    fireEvent.click(viewport as Element);
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing extra without an aside", () => {
    renderSheet(vi.fn(), false);
    expect(screen.queryByTestId("aside")).toBeNull();
  });
});
