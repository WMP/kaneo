import { InfoIcon } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import InvitationLinkField from "@/components/team/invitation-link-field";
import RoleSelect from "@/components/team/role-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import useInviteResource from "@/hooks/mutations/resource/use-invite-resource";
import useProjectAssignableRoles from "@/hooks/queries/resource/use-project-assignable-roles";
import useResourceInviteDefaults from "@/hooks/queries/resource/use-resource-invite-defaults";
import useGetAssignableRoles from "@/hooks/queries/workspace/use-get-assignable-roles";
import {
  getInvitationEmailMessageKey,
  useInvitationEmailDelivery,
} from "@/hooks/use-invitation-email-delivery";
import {
  getResourceErrorCode,
  getResourceErrorMessage,
} from "@/lib/resource-error";
import { toast } from "@/lib/toast";
import type Resource from "@/types/resource";

type Props = {
  resource: Resource;
  workspaceId: string;
  onClose: () => void;
  /** Offered when the address already belongs to a workspace member. */
  onLinkInstead: (resource: Resource) => void;
};

// Preferred role for a new invitation, in the workspace and in a project. The
// API decides which roles the caller may grant, so this only applies when it is
// in that list; anything else needs an explicit pick (a silent fallback to the
// first listed role could invite an admin).
const PREFERRED_ROLE = "member";

type Created = { id: string; email: string; created: boolean };

/**
 * "Invite" on a person resource: one invitation to the resource's email
 * address, with a workspace role and a role in each chosen project. The
 * projects the resource has tasks in are pre-selected. Which roles may be
 * offered comes from the API (the caller's own permissions, per project); the
 * API enforces the same again on send.
 */
function ResourceInviteDialog({
  resource,
  workspaceId,
  onClose,
  onLinkInstead,
}: Props) {
  const { t } = useTranslation();
  const emailDelivery = useInvitationEmailDelivery();
  const roleFieldId = useId();
  const inviteResource = useInviteResource(workspaceId);

  const workspaceRoles = useGetAssignableRoles(workspaceId);
  const projectsQuery = useResourceInviteDefaults(resource.id, true);
  const projects = projectsQuery.data ?? [];

  // What the user changed; everything else follows the defaults (the projects
  // the resource has tasks in are ticked, `member` is the preferred role).
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [workspaceRoleChoice, setWorkspaceRoleChoice] = useState<string | null>(
    null,
  );
  const [projectRoleChoice, setProjectRoleChoice] = useState<
    Record<string, string>
  >({});
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const isTicked = (projectId: string, hasAssignments: boolean) =>
    ticked[projectId] ?? hasAssignments;
  const selectedProjects = projects.filter((project) =>
    isTicked(project.id, project.hasAssignments),
  );
  const rolesByProject = useProjectAssignableRoles(
    selectedProjects.map((project) => project.id),
    true,
  );

  const workspaceRoleOptions = (workspaceRoles.data ?? []).map(
    (option) => option.role,
  );
  const workspaceRole =
    workspaceRoleChoice && workspaceRoleOptions.includes(workspaceRoleChoice)
      ? workspaceRoleChoice
      : workspaceRoleChoice === null &&
          workspaceRoleOptions.includes(PREFERRED_ROLE)
        ? PREFERRED_ROLE
        : undefined;

  const projectRoleOf = (projectId: string): string | undefined => {
    const options = (rolesByProject[projectId]?.roles ?? []).map(
      (option) => option.role,
    );
    const choice = projectRoleChoice[projectId];
    if (choice) return options.includes(choice) ? choice : undefined;
    return options.includes(PREFERRED_ROLE) ? PREFERRED_ROLE : undefined;
  };

  const everyProjectHasRole = selectedProjects.every((project) =>
    projectRoleOf(project.id),
  );
  const canSubmit =
    Boolean(workspaceRole) &&
    selectedProjects.length > 0 &&
    everyProjectHasRole &&
    !inviteResource.isPending;

  const submit = async () => {
    if (!workspaceRole) return;
    setErrorCode(null);
    setErrorText(null);
    const body = selectedProjects.flatMap((project) => {
      const role = projectRoleOf(project.id);
      return role ? [{ projectId: project.id, role }] : [];
    });
    try {
      const invitation = await inviteResource.mutateAsync({
        id: resource.id,
        workspaceRole,
        projects: body,
      });
      toast.success(
        invitation.created
          ? t(getInvitationEmailMessageKey("created", emailDelivery))
          : t("settings:workspaceResources.invite.addedToExisting"),
      );
      setCreated({
        id: invitation.id,
        email: invitation.email,
        created: invitation.created,
      });
    } catch (error) {
      setErrorCode(getResourceErrorCode(error) ?? null);
      setErrorText(
        getResourceErrorMessage(
          error,
          t,
          "settings:workspaceResources.invite.error",
        ),
      );
    }
  };

  const rolesBlocked =
    workspaceRoles.data !== undefined && workspaceRoleOptions.length === 0;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogPopup className="w-full max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {created
              ? t("settings:workspaceResources.invite.createdTitle")
              : t("settings:workspaceResources.invite.title", {
                  name: resource.name,
                })}
          </DialogTitle>
          {created ? null : (
            <DialogDescription>
              {t("settings:workspaceResources.invite.description", {
                email: resource.email ?? "",
              })}
            </DialogDescription>
          )}
        </DialogHeader>

        {created ? (
          <>
            <DialogPanel className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {created.created
                  ? t(
                      getInvitationEmailMessageKey("shareLink", emailDelivery),
                      { email: created.email },
                    )
                  : t("settings:workspaceResources.invite.addedToExisting")}
              </p>
              <InvitationLinkField invitationId={created.id} />
            </DialogPanel>
            <DialogFooter>
              <Button size="sm" onClick={onClose}>
                {t("team:inviteModal.done")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogPanel className="space-y-4">
              {emailDelivery === "not-sent" ? (
                <Alert variant="info" role="status">
                  <InfoIcon />
                  <AlertDescription>
                    {t("team:inviteModal.noSmtpNotice")}
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor={roleFieldId}>
                  {t("settings:workspaceResources.invite.workspaceRoleLabel")}
                </Label>
                {workspaceRoles.isLoading && !workspaceRoles.data ? (
                  <p className="text-sm text-muted-foreground" role="status">
                    {t("team:inviteModal.rolesLoading")}
                  </p>
                ) : !workspaceRoles.data ? (
                  <p className="text-sm text-destructive" role="alert">
                    {t("team:inviteModal.rolesError")}
                  </p>
                ) : rolesBlocked ? (
                  <p className="text-sm text-muted-foreground" role="status">
                    {t("team:inviteModal.noAssignableRoles")}
                  </p>
                ) : (
                  <>
                    <RoleSelect
                      id={roleFieldId}
                      roles={workspaceRoleOptions}
                      value={workspaceRole}
                      onChange={setWorkspaceRoleChoice}
                      placeholder={t("team:inviteModal.rolePlaceholder")}
                    />
                    {!workspaceRole ? (
                      <p className="text-sm text-muted-foreground">
                        {t("team:inviteModal.rolePickRequired")}
                      </p>
                    ) : null}
                  </>
                )}
              </div>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">
                  {t("settings:workspaceResources.invite.projectsLabel")}
                </legend>
                <p className="text-xs text-muted-foreground">
                  {t("settings:workspaceResources.invite.projectsHint")}
                </p>
                {projectsQuery.isLoading ? (
                  <p className="text-sm text-muted-foreground" role="status">
                    {t("settings:workspaceResources.invite.projectsLoading")}
                  </p>
                ) : projectsQuery.isError ? (
                  <p className="text-sm text-destructive" role="alert">
                    {t("settings:workspaceResources.invite.projectsError")}
                  </p>
                ) : projects.length === 0 ? (
                  <p className="text-sm text-muted-foreground" role="status">
                    {t("settings:workspaceResources.invite.noProjects")}
                  </p>
                ) : (
                  <ul className="divide-y divide-border rounded-md border">
                    {projects.map((project) => {
                      const checked = isTicked(
                        project.id,
                        project.hasAssignments,
                      );
                      const state = rolesByProject[project.id];
                      const options = (state?.roles ?? []).map(
                        (option) => option.role,
                      );
                      const checkboxId = `${roleFieldId}-${project.id}`;
                      return (
                        <li
                          key={project.id}
                          className="flex flex-wrap items-center gap-2 px-3 py-2"
                        >
                          <Checkbox
                            id={checkboxId}
                            checked={checked}
                            onCheckedChange={(next) =>
                              setTicked((current) => ({
                                ...current,
                                [project.id]: next === true,
                              }))
                            }
                          />
                          <Label
                            htmlFor={checkboxId}
                            className="min-w-0 flex-1 truncate"
                          >
                            {project.name}
                          </Label>
                          {project.hasAssignments ? (
                            <Badge variant="outline" size="sm">
                              {t("settings:workspaceResources.invite.hasTasks")}
                            </Badge>
                          ) : null}
                          {checked ? (
                            state?.isLoading && !state.roles ? (
                              <span
                                className="text-xs text-muted-foreground"
                                role="status"
                              >
                                {t(
                                  "settings:workspaceResources.invite.projectRolesLoading",
                                )}
                              </span>
                            ) : !state?.roles ? (
                              <span
                                className="text-xs text-destructive"
                                role="alert"
                              >
                                {t(
                                  "settings:workspaceResources.invite.projectRolesError",
                                )}
                              </span>
                            ) : options.length === 0 ? (
                              <span className="text-xs text-muted-foreground">
                                {t(
                                  "settings:workspaceResources.invite.noProjectRoles",
                                )}
                              </span>
                            ) : (
                              <RoleSelect
                                size="sm"
                                className="w-36"
                                roles={options}
                                value={projectRoleOf(project.id)}
                                onChange={(role) =>
                                  setProjectRoleChoice((current) => ({
                                    ...current,
                                    [project.id]: role,
                                  }))
                                }
                                placeholder={t(
                                  "team:inviteModal.rolePlaceholder",
                                )}
                                ariaLabel={t(
                                  "settings:workspaceResources.invite.projectRoleLabel",
                                  { project: project.name },
                                )}
                              />
                            )
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {projects.length > 0 && selectedProjects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("settings:workspaceResources.invite.pickProject")}
                  </p>
                ) : null}
              </fieldset>

              {errorText ? (
                <Alert variant="error" role="alert">
                  <AlertDescription className="space-y-2">
                    <p>{errorText}</p>
                    {errorCode === "ALREADY_WORKSPACE_MEMBER" ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={() => onLinkInstead(resource)}
                      >
                        {t("settings:workspaceResources.linkAction")}
                      </Button>
                    ) : null}
                  </AlertDescription>
                </Alert>
              ) : null}
            </DialogPanel>

            <DialogFooter>
              <DialogClose
                render={<Button variant="outline" size="sm" type="button" />}
              >
                {t("common:actions.cancel")}
              </DialogClose>
              <Button
                size="sm"
                onClick={submit}
                disabled={!canSubmit}
                aria-busy={inviteResource.isPending}
              >
                {inviteResource.isPending
                  ? t("team:inviteModal.sending")
                  : t("team:inviteModal.sendInvitation")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogPopup>
    </Dialog>
  );
}

export default ResourceInviteDialog;
