import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeleteProjectMenuItem } from "./delete-project-menu-item";

const permission = vi.hoisted(() => ({
  projectId: undefined as string | undefined,
  state: { canDelete: false, checking: false },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-project-permission", () => ({
  useProjectPermission: (projectId: string) => {
    permission.projectId = projectId;
    return {
      canDeleteProject: () => permission.state.canDelete,
      isCheckingPermissions: permission.state.checking,
    };
  },
}));
vi.mock("@/components/ui/menu", () => ({
  DropdownMenuItem: (props: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

afterEach(() => {
  cleanup();
  permission.state = { canDelete: false, checking: false };
});

const label = "navigation:projectList.deleteProject";

describe("DeleteProjectMenuItem", () => {
  it("asks for its own project and is offered when the project allows deleting", () => {
    permission.state = { canDelete: true, checking: false };
    const onSelect = vi.fn();
    render(<DeleteProjectMenuItem projectId="project-7" onSelect={onSelect} />);

    expect(permission.projectId).toBe("project-7");
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("is shown disabled while the permissions load, instead of popping in", () => {
    permission.state = { canDelete: false, checking: true };
    render(<DeleteProjectMenuItem projectId="project-7" onSelect={vi.fn()} />);

    expect(screen.getByRole("button", { name: label })).toBeDisabled();
  });

  it("is left out when the project does not allow deleting", () => {
    permission.state = { canDelete: false, checking: false };
    render(<DeleteProjectMenuItem projectId="project-7" onSelect={vi.fn()} />);

    expect(screen.queryByRole("button", { name: label })).toBeNull();
  });
});
