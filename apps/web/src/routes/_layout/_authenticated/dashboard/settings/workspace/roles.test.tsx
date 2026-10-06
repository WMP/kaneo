import { defaultRolePayloads } from "@kaneo/permissions";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/lib/toast";
import { WorkspaceMemberError } from "@/lib/workspace-role-error";
import { GRANTED_CHECKBOX_CLASS, RolePermissionMatrix } from "./roles";

const m = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@/hooks/mutations/workspace/use-update-workspace-role", () => ({
  default: () => ({ mutateAsync: m.update, isPending: false }),
}));
vi.mock("@/hooks/mutations/workspace/use-create-workspace-role", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/mutations/workspace/use-delete-workspace-role", () => ({
  default: () => ({}),
}));
vi.mock("@/hooks/queries/workspace/use-workspace-roles", () => ({
  default: () => ({}),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({}),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const makeRole = (role: string, permission: Record<string, string[]>) => ({
  id: `id-${role}`,
  workspaceId: "workspace",
  role,
  permission,
  createdAt: new Date(),
});
const renderMatrix = (roles: ReturnType<typeof makeRole>[]) =>
  render(
    <RolePermissionMatrix
      roles={roles}
      workspaceId="workspace"
      onDeleteRole={() => {}}
    />,
  );
const save = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "settings:workspaceRoles.saveChanges" }),
  );

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
  m.update.mockResolvedValue({ success: true });
});

describe("workspace role permission matrix", () => {
  it("renders a column per role with checkboxes matching the stored permissions", () => {
    renderMatrix([
      makeRole("admin", defaultRolePayloads.admin),
      makeRole("viewer", defaultRolePayloads.viewer),
    ]);
    const headers = screen
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers.some((h) => h?.includes("viewer"))).toBe(true);
    expect(headers.some((h) => h?.includes("admin"))).toBe(true);
    // Default roles are sorted viewer -> admin regardless of input order.
    expect(
      screen.getAllByRole("checkbox", { name: /Change role permissions/ }),
    ).toHaveLength(2);
    expect(
      screen.getByRole("checkbox", { name: "Change role permissions — admin" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: "Change role permissions — viewer",
      }),
    ).not.toBeChecked();
    const viewerChecked = (defaultRolePayloads.viewer.task ?? []).length;
    expect(viewerChecked).toBeGreaterThan(0);
    expect(
      screen.getByRole("checkbox", { name: "View tasks — viewer" }),
    ).toBeChecked();
  });

  it("can remove every permission, including all provider administrative rights", async () => {
    renderMatrix([makeRole("admin", defaultRolePayloads.admin)]);
    for (const control of screen.getAllByRole("checkbox", { checked: true }))
      fireEvent.click(control);
    save();
    await waitFor(() =>
      expect(m.update).toHaveBeenCalledWith({
        workspaceId: "workspace",
        roleName: "admin",
        permission: {},
      }),
    );
  });

  it("saves only the roles that changed", async () => {
    renderMatrix([
      makeRole("viewer", defaultRolePayloads.viewer),
      makeRole("admin", defaultRolePayloads.admin),
    ]);
    expect(
      screen.getByRole("button", {
        name: "settings:workspaceRoles.saveChanges",
      }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Change role permissions — admin" }),
    );
    save();
    await waitFor(() => expect(m.update).toHaveBeenCalledTimes(1));
    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({ roleName: "admin" }),
    );
  });

  it("discards unsaved changes", () => {
    renderMatrix([makeRole("admin", defaultRolePayloads.admin)]);
    const box = screen.getByRole("checkbox", {
      name: "Change role permissions — admin",
    });
    fireEvent.click(box);
    expect(box).not.toBeChecked();
    fireEvent.click(
      screen.getByRole("button", { name: "settings:workspaceRoles.discard" }),
    );
    expect(box).toBeChecked();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("explains that a role still used by project members cannot be changed", async () => {
    m.update.mockRejectedValue(
      new WorkspaceMemberError("", {
        code: "ROLE_IS_ASSIGNED_TO_PROJECT_MEMBERS",
        status: 409,
      }),
    );
    renderMatrix([makeRole("qa-lead", { task: ["read"] })]);
    fireEvent.click(screen.getAllByRole("checkbox", { checked: true })[0]);
    save();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "projectMembers:errors.roleAssignedToProjectMembers",
      ),
    );
  });

  it("also exposes unknown stored permission entries instead of silently retaining them", async () => {
    renderMatrix([makeRole("qa-lead", { extension: ["future-right"] })]);
    const box = screen.getByRole("checkbox", {
      name: "future-right extension — qa-lead",
    });
    expect(box).toBeChecked();
    fireEvent.click(box);
    save();
    await waitFor(() =>
      expect(m.update).toHaveBeenCalledWith({
        workspaceId: "workspace",
        roleName: "qa-lead",
        permission: {},
      }),
    );
  });

  it("marks granted cells with the green styling hook", () => {
    renderMatrix([makeRole("viewer", { task: ["read"] })]);
    const granted = screen.getByRole("checkbox", {
      name: "View tasks — viewer",
    });
    expect(granted).toHaveAttribute("data-checked");
    expect(GRANTED_CHECKBOX_CLASS).toContain("green-600");
    expect(granted.className).toContain("data-checked:border-green-600");
    expect(granted.className).toContain("checkbox-indicator");
    expect(
      screen.getByRole("checkbox", { name: "Edit tasks — viewer" }),
    ).not.toHaveAttribute("data-checked");
  });
});
