import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { AlertDialogCreateHandle } from "@/components/ui/alert-dialog";
import { ShortcutTestWrapper } from "@/lib/shortcuts/shortcut-test-wrapper";
import { TaskMoreMenu } from "./task-more-menu";

const mocks = vi.hoisted(() => ({
  canDeleteTasks: vi.fn(),
  permissionProject: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/hooks/use-project-permission", () => ({
  useProjectPermission: (projectId: string) => {
    mocks.permissionProject(projectId);
    return { canDeleteTasks: mocks.canDeleteTasks };
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const actions = {
  copyLink: vi.fn(),
  copyBranch: vi.fn(),
  copyId: vi.fn(),
  copyTitle: vi.fn(),
  copyMarkdown: vi.fn(),
} as unknown as Parameters<typeof TaskMoreMenu>[0]["actions"];

function openMenu() {
  render(
    <ShortcutTestWrapper>
      <TaskMoreMenu
        projectId="project-1"
        actions={actions}
        deleteHandle={AlertDialogCreateHandle()}
      />
    </ShortcutTestWrapper>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "tasks:bulk.moreActions" }),
  );
}

describe("TaskMoreMenu", () => {
  it("offers deletion to somebody who may delete tasks in the task's project", async () => {
    mocks.canDeleteTasks.mockReturnValue(true);
    openMenu();

    expect(
      await screen.findByRole("menuitem", { name: /tasks:delete.action/ }),
    ).toBeVisible();
    // Deleting is decided by the task's own project, not the workspace role.
    expect(mocks.permissionProject).toHaveBeenCalledWith("project-1");
  });

  it("leaves deletion out without the project permission", async () => {
    mocks.canDeleteTasks.mockReturnValue(false);
    openMenu();

    await screen.findByRole("menuitem", {
      name: /navigation:shortcuts.items.copyTaskId/,
    });
    expect(
      screen.queryByRole("menuitem", { name: /tasks:delete.action/ }),
    ).toBeNull();
  });
});
