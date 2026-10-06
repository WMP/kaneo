import { DEFAULT_ROLE_NAMES, statement } from "@kaneo/permissions";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Shield, Trash2, X } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import useCreateWorkspaceRole from "@/hooks/mutations/workspace/use-create-workspace-role";
import useDeleteWorkspaceRole from "@/hooks/mutations/workspace/use-delete-workspace-role";
import useUpdateWorkspaceRole from "@/hooks/mutations/workspace/use-update-workspace-role";
import useWorkspaceRoles, {
  type WorkspaceRole,
} from "@/hooks/queries/workspace/use-workspace-roles";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";
import { getWorkspaceMemberErrorMessage } from "@/lib/workspace-role-error";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/roles",
)({
  component: RouteComponent,
});

// Every permission that can be saved must also be visible and removable.
// Include provider-owned resources and persisted unknown entries in the editor.
const RESOURCE_LABELS: Record<string, string> = {
  organization: "Workspace administration",
  member: "Members",
  invitation: "Invitations",
  team: "Teams",
  ac: "Roles and permissions",
  project: "Projects",
  task: "Tasks",
  label: "Labels",
  workspace: "Workspace",
};

const PERMISSION_LABELS: Record<
  string,
  { label: string; description: string }
> = {
  "organization:update": {
    label: "Edit workspace administration",
    description: "Change workspace settings through the account service.",
  },
  "organization:delete": {
    label: "Delete workspace",
    description:
      "Permanently delete the workspace through the account service.",
  },
  "member:create": {
    label: "Add members",
    description: "Add users to this workspace.",
  },
  "member:update": {
    label: "Change member roles",
    description: "Change the roles assigned to workspace members.",
  },
  "member:delete": {
    label: "Remove members",
    description: "Remove users from this workspace.",
  },
  "invitation:create": {
    label: "Invite members",
    description: "Send workspace invitations.",
  },
  "invitation:cancel": {
    label: "Cancel invitations",
    description: "Revoke pending workspace invitations.",
  },
  "team:create": {
    label: "Create teams",
    description: "Create teams in this workspace.",
  },
  "team:update": {
    label: "Edit teams",
    description: "Change teams and team membership.",
  },
  "team:delete": {
    label: "Delete teams",
    description: "Delete teams in this workspace.",
  },
  "ac:create": {
    label: "Create roles",
    description: "Create workspace roles and assign their permissions.",
  },
  "ac:read": {
    label: "View roles",
    description: "Read the workspace roles and their permissions.",
  },
  "ac:update": {
    label: "Change role permissions",
    description: "Change role permissions, including administrative access.",
  },
  "ac:delete": {
    label: "Delete roles",
    description: "Delete custom workspace roles.",
  },
  "project:create": {
    label: "Create projects",
    description: "Create new projects in this workspace.",
  },
  "project:read": {
    label: "View projects",
    description: "View projects and their details.",
  },
  "project:update": {
    label: "Edit projects",
    description: "Update project name, icon, description, and settings.",
  },
  "project:delete": {
    label: "Delete projects",
    description: "Permanently delete projects in this workspace.",
  },
  "project:share": {
    label: "Share projects",
    description: "Make projects publicly accessible via share links.",
  },
  "task:create": {
    label: "Create tasks",
    description: "Create new tasks in any project.",
  },
  "task:read": {
    label: "View tasks",
    description: "View tasks across projects.",
  },
  "task:update": {
    label: "Edit tasks",
    description: "Edit task content, status, priority, due date, and labels.",
  },
  "task:delete": {
    label: "Delete tasks",
    description: "Permanently delete tasks.",
  },
  "task:assign": {
    label: "Assign tasks",
    description: "Assign tasks to other workspace members.",
  },
  "label:create": {
    label: "Create labels",
    description: "Add new labels to tasks in this workspace.",
  },
  "label:read": {
    label: "View labels",
    description: "View labels attached to tasks.",
  },
  "label:update": {
    label: "Edit labels",
    description: "Rename, recolor, and reassign labels.",
  },
  "label:delete": {
    label: "Delete labels",
    description: "Permanently delete labels from this workspace.",
  },
  "workspace:read": {
    label: "Access workspace",
    description: "Read workspace metadata and members.",
  },
  "workspace:update": {
    label: "Edit workspace",
    description: "Edit workspace name and description.",
  },
  "workspace:delete": {
    label: "Delete workspace",
    description: "Permanently delete this workspace.",
  },
  "workspace:manage_settings": {
    label: "Manage settings",
    description:
      "Configure integrations, notification rules, and workspace preferences.",
  },
};

// Default roles are seeded per workspace by the API (see
// `seedDefaultWorkspaceRoles` and the afterCreateOrganization hook). They show
// up in `customRoles` like any other dynamic role but get a "Default" badge,
// can't be deleted, and reserve their names against new custom roles. Owner
// stays a static role on the auth side and is hidden from this UI, but its
// name is still reserved here.
const DEFAULT_ROLE_NAME_SET = new Set<string>(DEFAULT_ROLE_NAMES);
const RESERVED_ROLE_NAMES = [...DEFAULT_ROLE_NAMES, "owner"];

function isDefaultRole(name: string) {
  return DEFAULT_ROLE_NAME_SET.has(name);
}

function permissionsEqual(
  a: Record<string, string[]>,
  b: Record<string, string[]>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const arrA = [...(a[key] ?? [])].sort();
    const arrB = [...(b[key] ?? [])].sort();
    if (arrA.length !== arrB.length) return false;
    for (let i = 0; i < arrA.length; i++) {
      if (arrA[i] !== arrB[i]) return false;
    }
  }
  return true;
}

function permissionCount(permissions: Record<string, string[] | undefined>) {
  return Object.values(permissions).reduce(
    (sum, actions) => sum + (actions?.length ?? 0),
    0,
  );
}

function RouteComponent() {
  const { t } = useTranslation();
  const { workspace, isAdmin } = useWorkspacePermission();
  const workspaceId = workspace?.id ?? "";
  const {
    data: customRoles = [],
    isLoading,
    isError: customRolesError,
    error: customRolesErrorValue,
  } = useWorkspaceRoles(workspaceId);
  const [draftActive, setDraftActive] = useState(false);
  const [roleToDelete, setRoleToDelete] = useState<WorkspaceRole | null>(null);

  if (!isAdmin) {
    return (
      <>
        <PageTitle title={t("settings:workspaceRoles.pageTitle")} />
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">
              {t("settings:workspaceRoles.title")}
            </h1>
            <p className="text-muted-foreground">
              {t("settings:workspaceRoles.noAccess")}
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageTitle title={t("settings:workspaceRoles.pageTitle")} />
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("settings:workspaceRoles.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("settings:workspaceRoles.subtitle", {
              workspaceName:
                workspace?.name ?? t("settings:workspaceRoles.thisWorkspace"),
            })}
          </p>
        </div>

        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-md font-medium">
                {t("settings:workspaceRoles.sectionTitle")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("settings:workspaceRoles.sectionSubtitle")}
              </p>
            </div>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => setDraftActive(true)}
              disabled={draftActive}
            >
              <Plus className="w-3.5 h-3.5" />
              {t("settings:workspaceRoles.newRole")}
            </Button>
          </div>
          {isLoading && !draftActive ? (
            <div className="border border-border rounded-md bg-sidebar">
              <p className="text-xs text-muted-foreground px-4 py-6">
                {t("settings:workspaceRoles.loading")}
              </p>
            </div>
          ) : customRolesError ? (
            <div className="border border-border rounded-md bg-sidebar">
              <p className="text-xs text-destructive px-4 py-6">
                {customRolesErrorValue instanceof Error
                  ? customRolesErrorValue.message
                  : t("settings:workspaceRoles.loadError")}
              </p>
            </div>
          ) : customRoles.length === 0 && !draftActive ? (
            <div className="border border-border rounded-md bg-sidebar">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Shield />
                  </EmptyMedia>
                  <EmptyTitle>
                    {t("settings:workspaceRoles.emptyTitle")}
                  </EmptyTitle>
                  <EmptyDescription>
                    {t("settings:workspaceRoles.emptyDescription")}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
          ) : (
            <RolePermissionMatrix
              roles={customRoles}
              workspaceId={workspaceId}
              onDeleteRole={setRoleToDelete}
              creating={draftActive}
              onCloseCreate={() => setDraftActive(false)}
            />
          )}
        </div>
      </div>

      <AlertDialog
        open={!!roleToDelete}
        onOpenChange={(open) => !open && setRoleToDelete(null)}
      >
        <DeleteRoleConfirm
          role={roleToDelete}
          workspaceId={workspaceId}
          onDeleted={() => setRoleToDelete(null)}
          onCancel={() => setRoleToDelete(null)}
        />
      </AlertDialog>
    </>
  );
}

type PermissionDraft = Record<string, Set<string>>;

// Classes that turn a checked permission cell green. The indicator paints the
// filled square (`data-checked:bg-primary` in the shared Checkbox), so it is
// overridden through a descendant selector with higher specificity.
export const GRANTED_CHECKBOX_CLASS =
  "data-checked:border-green-600 **:data-[slot=checkbox-indicator]:data-checked:bg-green-600";

function toDraft(permission: Partial<Record<string, string[]>>) {
  const out: PermissionDraft = Object.create(null);
  for (const [resource, actions] of Object.entries(permission)) {
    out[resource] = new Set(actions);
  }
  return out;
}

function fromDraft(draft: PermissionDraft) {
  const out: Record<string, string[]> = Object.create(null);
  for (const [resource, set] of Object.entries(draft)) {
    if (set.size > 0) out[resource] = Array.from(set);
  }
  return out;
}

function toggleInDraft(
  draft: PermissionDraft,
  resource: string,
  action: string,
): PermissionDraft {
  const next: PermissionDraft = Object.assign(Object.create(null), draft);
  const set = new Set(next[resource] ?? []);
  if (set.has(action)) set.delete(action);
  else set.add(action);
  next[resource] = set;
  return next;
}

function isInDraft(draft: PermissionDraft, resource: string, action: string) {
  return Object.hasOwn(draft, resource) && draft[resource].has(action);
}

export function RolePermissionMatrix({
  roles,
  workspaceId,
  onDeleteRole,
  creating = false,
  onCloseCreate,
}: {
  roles: WorkspaceRole[];
  workspaceId: string;
  onDeleteRole: (role: WorkspaceRole) => void;
  creating?: boolean;
  onCloseCreate?: () => void;
}) {
  const { t } = useTranslation();
  const baseId = useId();
  const { mutateAsync: updateRole, isPending: isUpdating } =
    useUpdateWorkspaceRole();
  const { mutateAsync: createRole, isPending: isCreating } =
    useCreateWorkspaceRole();
  const isPending = isUpdating || isCreating;

  // Defaults (viewer/member/admin) first so they anchor the matrix, then
  // user-created roles in their natural order.
  const sortedRoles = useMemo(() => {
    const defaults: WorkspaceRole[] = [];
    const custom: WorkspaceRole[] = [];
    for (const role of roles) {
      if (isDefaultRole(role.role)) defaults.push(role);
      else custom.push(role);
    }
    defaults.sort(
      (a, b) =>
        DEFAULT_ROLE_NAMES.indexOf(a.role as never) -
        DEFAULT_ROLE_NAMES.indexOf(b.role as never),
    );
    return [...defaults, ...custom];
  }, [roles]);

  // Only roles the user touched hold a draft; every other role reads straight
  // from server data, so it follows refetches without any syncing.
  const [edits, setEdits] = useState<Record<string, PermissionDraft>>({});
  const [newName, setNewName] = useState("");
  const [newDraft, setNewDraft] = useState<PermissionDraft>(() =>
    Object.create(null),
  );

  // Drop drafts that no longer differ from the server (saved, reverted or
  // role deleted) so later server changes show through.
  useEffect(() => {
    setEdits((prev) => {
      let changed = false;
      const next: Record<string, PermissionDraft> = {};
      for (const [name, draft] of Object.entries(prev)) {
        const role = roles.find((r) => r.role === name);
        if (role && !permissionsEqual(fromDraft(draft), role.permission)) {
          next[name] = draft;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [roles]);

  useEffect(() => {
    if (!creating) {
      setNewName("");
      setNewDraft(Object.create(null));
    }
  }, [creating]);

  const draftFor = useCallback(
    (role: WorkspaceRole): PermissionDraft =>
      Object.hasOwn(edits, role.role)
        ? edits[role.role]
        : toDraft(role.permission),
    [edits],
  );

  const dirtyRoles = sortedRoles.filter(
    (role) =>
      Object.hasOwn(edits, role.role) &&
      !permissionsEqual(fromDraft(edits[role.role]), role.permission),
  );
  const dirtyNames = new Set(dirtyRoles.map((role) => role.role));

  // Every permission that can be saved must also be visible and removable, so
  // the rows cover the known statement plus anything persisted or drafted.
  const groups = useMemo(() => {
    const known = statement as Record<string, readonly string[]>;
    const sources: Partial<Record<string, readonly string[]>>[] = [
      ...roles.map((role) => role.permission),
      ...Object.values(edits).map(fromDraft),
      fromDraft(newDraft),
    ];
    const resources = new Set(Object.keys(known));
    for (const source of sources) {
      for (const resource of Object.keys(source)) resources.add(resource);
    }
    return [...resources].map((resource) => {
      const actions = new Set(
        Object.hasOwn(known, resource) ? known[resource] : [],
      );
      for (const source of sources) {
        if (!Object.hasOwn(source, resource)) continue;
        for (const action of source[resource] ?? []) actions.add(action);
      }
      return { resource, actions: [...actions] };
    });
  }, [roles, edits, newDraft]);

  const toggleRole = (role: WorkspaceRole, resource: string, action: string) =>
    setEdits((prev) => {
      const current = Object.hasOwn(prev, role.role)
        ? prev[role.role]
        : toDraft(role.permission);
      const next = toggleInDraft(current, resource, action);
      const result = Object.assign(Object.create(null), prev) as Record<
        string,
        PermissionDraft
      >;
      if (permissionsEqual(fromDraft(next), role.permission)) {
        delete result[role.role];
      } else {
        result[role.role] = next;
      }
      return result;
    });

  const handleDiscard = () => setEdits({});

  const handleSave = async () => {
    for (const role of dirtyRoles) {
      try {
        await updateRole({
          workspaceId,
          roleName: role.role,
          permission: fromDraft(edits[role.role]),
        });
        toast.success(t("settings:workspaceRoles.toast.updated"));
      } catch (error) {
        // The failed role stays dirty so the change can be retried.
        toast.error(
          getWorkspaceMemberErrorMessage(
            error,
            t,
            "settings:workspaceRoles.toast.updateError",
          ),
        );
      }
    }
  };

  const handleCreate = async () => {
    const trimmed = newName.trim().toLowerCase();
    if (!trimmed) {
      toast.error(t("settings:workspaceRoles.validation.nameRequired"));
      return;
    }
    const taken = [...RESERVED_ROLE_NAMES, ...roles.map((r) => r.role)];
    if (taken.map((n) => n.toLowerCase()).includes(trimmed)) {
      toast.error(t("settings:workspaceRoles.validation.nameExists"));
      return;
    }
    const permission = fromDraft(newDraft);
    if (Object.keys(permission).length === 0) {
      toast.error(t("settings:workspaceRoles.validation.permissionRequired"));
      return;
    }
    try {
      await createRole({ workspaceId, role: trimmed, permission });
      toast.success(t("settings:workspaceRoles.toast.created"));
      onCloseCreate?.();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:workspaceRoles.toast.createError"),
      );
    }
  };

  const columnCount = sortedRoles.length + (creating ? 1 : 0);
  const dirty = dirtyRoles.length > 0;
  const stickyCell = "sticky left-0 z-10 bg-sidebar";

  return (
    <div className="space-y-3">
      <div className="border border-border rounded-md bg-sidebar">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th
                  scope="col"
                  className={`${stickyCell} top-0 z-30 min-w-52 border-b border-border px-4 py-3 text-left align-bottom text-xs font-medium text-muted-foreground`}
                >
                  {t("settings:workspaceRoles.permissionColumn")}
                </th>
                {sortedRoles.map((role) => {
                  const isDefault = isDefaultRole(role.role);
                  const roleLabel = roleDisplayLabel(role.role, t);
                  const isDirty = dirtyNames.has(role.role);
                  return (
                    <th
                      key={role.id}
                      scope="col"
                      className={`sticky top-0 z-20 min-w-32 border-b border-border px-3 py-3 text-center align-bottom font-normal ${
                        isDirty ? "bg-muted" : "bg-sidebar"
                      }`}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-sm font-medium ${
                              isDefault ? "" : "capitalize"
                            }`}
                          >
                            {roleLabel}
                          </span>
                          {isDirty && (
                            <span
                              role="img"
                              aria-label={t(
                                "settings:workspaceRoles.unsavedChanges",
                              )}
                              title={t(
                                "settings:workspaceRoles.unsavedChanges",
                              )}
                              className="size-1.5 rounded-full bg-amber-500"
                            />
                          )}
                          {!isDefault && (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="text-muted-foreground hover:text-destructive"
                              aria-label={t(
                                "settings:workspaceRoles.deleteRoleAria",
                                { role: role.role },
                              )}
                              onClick={() => onDeleteRole(role)}
                              disabled={isPending}
                            >
                              <Trash2 />
                            </Button>
                          )}
                        </div>
                        {isDefault && (
                          <span className="text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {t("settings:workspaceRoles.defaultBadge")}
                          </span>
                        )}
                        <span className="text-xs font-normal text-muted-foreground">
                          {t("settings:workspaceRoles.permissionCount", {
                            count: permissionCount(fromDraft(draftFor(role))),
                          })}
                        </span>
                      </div>
                    </th>
                  );
                })}
                {creating && (
                  <th
                    scope="col"
                    className="sticky top-0 z-20 min-w-56 border-b border-border bg-muted px-3 py-3 text-center align-bottom font-normal"
                  >
                    <div className="flex flex-col gap-2">
                      <Input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleCreate();
                        }}
                        placeholder={t(
                          "settings:workspaceRoles.namePlaceholder",
                        )}
                        aria-label={t("settings:workspaceRoles.nameLabel")}
                        autoFocus
                        disabled={isPending}
                      />
                      <div className="flex items-center justify-center gap-1.5">
                        <Button
                          size="sm"
                          onClick={handleCreate}
                          disabled={isPending}
                        >
                          {t("settings:workspaceRoles.createRole")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("settings:workspaceRoles.discard")}
                          onClick={() => onCloseCreate?.()}
                          disabled={isPending}
                        >
                          <X />
                        </Button>
                      </div>
                    </div>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {groups.map(({ resource, actions }) => {
                const groupId = `${baseId}-group-${resource}`;
                return (
                  <Fragment key={resource}>
                    <tr>
                      <th
                        id={groupId}
                        scope="colgroup"
                        colSpan={columnCount + 1}
                        className="border-b border-border bg-muted/50 px-4 py-2 text-left"
                      >
                        <span className="sticky left-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {t(`settings:workspaceRoles.resources.${resource}`, {
                            defaultValue: Object.hasOwn(
                              RESOURCE_LABELS,
                              resource,
                            )
                              ? RESOURCE_LABELS[resource]
                              : resource.charAt(0).toUpperCase() +
                                resource.slice(1),
                          })}
                        </span>
                      </th>
                    </tr>
                    {actions.map((action) => {
                      const meta = Object.hasOwn(
                        PERMISSION_LABELS,
                        `${resource}:${action}`,
                      )
                        ? PERMISSION_LABELS[`${resource}:${action}`]
                        : { label: `${action} ${resource}`, description: "" };
                      const permissionLabel = t(
                        `settings:workspaceRoles.permissions.${resource}.${action}.label`,
                        { defaultValue: meta.label },
                      );
                      const description = meta.description
                        ? t(
                            `settings:workspaceRoles.permissions.${resource}.${action}.description`,
                            { defaultValue: meta.description },
                          )
                        : "";
                      return (
                        <tr key={`${resource}:${action}`}>
                          <th
                            scope="row"
                            className={`${stickyCell} border-b border-border px-4 py-2.5 text-left font-normal`}
                          >
                            <div className="text-sm font-medium">
                              {permissionLabel}
                            </div>
                            {description && (
                              <div className="text-xs text-muted-foreground">
                                {description}
                              </div>
                            )}
                          </th>
                          {sortedRoles.map((role) => (
                            <td
                              key={role.id}
                              className={`border-b border-border px-3 py-2.5 text-center ${
                                dirtyNames.has(role.role) ? "bg-muted/60" : ""
                              }`}
                            >
                              <Checkbox
                                className={GRANTED_CHECKBOX_CLASS}
                                checked={isInDraft(
                                  draftFor(role),
                                  resource,
                                  action,
                                )}
                                onCheckedChange={() =>
                                  toggleRole(role, resource, action)
                                }
                                disabled={isPending}
                                aria-label={`${permissionLabel} — ${roleDisplayLabel(role.role, t)}`}
                                aria-describedby={groupId}
                              />
                            </td>
                          ))}
                          {creating && (
                            <td className="border-b border-border bg-muted/60 px-3 py-2.5 text-center">
                              <Checkbox
                                className={GRANTED_CHECKBOX_CLASS}
                                checked={isInDraft(newDraft, resource, action)}
                                onCheckedChange={() =>
                                  setNewDraft((prev) =>
                                    toggleInDraft(prev, resource, action),
                                  )
                                }
                                disabled={isPending}
                                aria-label={`${permissionLabel} — ${
                                  newName.trim() ||
                                  t("settings:workspaceRoles.newRole")
                                }`}
                                aria-describedby={groupId}
                              />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-border px-4 py-3">
          <p className="mr-auto text-xs text-muted-foreground">
            {dirty
              ? t("settings:workspaceRoles.unsavedChanges")
              : t("settings:workspaceRoles.allChangesSaved")}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDiscard}
            disabled={isPending || !dirty}
          >
            {t("settings:workspaceRoles.discard")}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isPending || !dirty}>
            {t("settings:workspaceRoles.saveChanges")}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("settings:workspaceRoles.defaultRoleHelp")}
      </p>
    </div>
  );
}

function roleDisplayLabel(
  name: string,
  t: (key: string, options?: { defaultValue?: string }) => string,
) {
  return isDefaultRole(name)
    ? t(`team:roles.${name}`, { defaultValue: name })
    : name;
}

function DeleteRoleConfirm({
  role,
  workspaceId,
  onDeleted,
  onCancel,
}: {
  role: WorkspaceRole | null;
  workspaceId: string;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { mutateAsync: deleteRole, isPending } = useDeleteWorkspaceRole();

  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {t("settings:workspaceRoles.deleteDialog.title")}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {role
            ? t("settings:workspaceRoles.deleteDialog.description", {
                role: role.role,
              })
            : ""}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogClose
          render={
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={onCancel}
            />
          }
        >
          {t("common:actions.cancel")}
        </AlertDialogClose>
        <Button
          variant="destructive"
          size="sm"
          disabled={isPending || !role}
          onClick={async () => {
            if (!role) return;
            try {
              await deleteRole({ workspaceId, roleName: role.role });
              toast.success(t("settings:workspaceRoles.toast.deleted"));
              // Caller closes the dialog after the mutation succeeds so a
              // failed delete leaves the confirmation visible.
              onDeleted();
            } catch (error) {
              toast.error(
                getWorkspaceMemberErrorMessage(
                  error,
                  t,
                  "settings:workspaceRoles.toast.deleteError",
                ),
              );
            }
          }}
        >
          <Trash2 className="w-4 h-4 mr-2" />
          {t("common:actions.delete")}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}
