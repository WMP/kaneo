import { InfoIcon } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
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
import useGetProjectAssignableRoles from "@/hooks/queries/project-member/use-get-project-assignable-roles";
import useResourceInviteDefaults from "@/hooks/queries/resource/use-resource-invite-defaults";
import useGetAssignableRoles from "@/hooks/queries/workspace/use-get-assignable-roles";
import { useInvitationEmailDelivery } from "@/hooks/use-invitation-email-delivery";
import { useRoleChoice } from "@/hooks/use-role-choice";
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
  /** May the caller link a resource to a member (what the API requires)? */
  canLink: boolean;
  /** Projects ticked by default besides the ones the resource has tasks in
   * (the project the dialog was opened from). */
  defaultProjectIds?: string[];
};

type Created = { id: string; message: string };

type ProjectRow = { id: string; name: string; hasAssignments: boolean };

type RowProps = {
  project: ProjectRow;
  checked: boolean;
  checkboxId: string;
  onCheckedChange: (checked: boolean) => void;
  /** The role that will be sent for this project (undefined until valid). */
  onRoleChange: (projectId: string, role: string | undefined) => void;
};

// One project of the invitation: its own list of grantable roles (the caller's
// permissions in THAT project) and its own role choice (`useRoleChoice`, shared
// with the other invite dialogs: only `member` is ever picked for the user).
function ProjectInviteRow({
  project,
  checked,
  checkboxId,
  onCheckedChange,
  onRoleChange,
}: RowProps) {
  const { t } = useTranslation();
  const rolesQuery = useGetProjectAssignableRoles(project.id, {
    enabled: checked,
  });
  const options = rolesQuery.data?.map((option) => option.role);
  const choice = useRoleChoice(options);
  const role = checked ? choice.role : undefined;

  useEffect(() => {
    onRoleChange(project.id, role);
  }, [onRoleChange, project.id, role]);

  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2">
      <Checkbox
        id={checkboxId}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
      />
      <Label htmlFor={checkboxId} className="min-w-0 flex-1 truncate">
        {project.name}
      </Label>
      {project.hasAssignments ? (
        <Badge variant="outline" size="sm">
          {t("settings:workspaceResources.invite.hasTasks")}
        </Badge>
      ) : null}
      {checked ? (
        rolesQuery.isLoading && !options ? (
          <span className="text-xs text-muted-foreground" role="status">
            {t("settings:workspaceResources.invite.projectRolesLoading")}
          </span>
        ) : !options ? (
          <span className="text-xs text-destructive" role="alert">
            {t("settings:workspaceResources.invite.projectRolesError")}
          </span>
        ) : choice.isEmpty ? (
          <span className="text-xs text-muted-foreground">
            {t("settings:workspaceResources.invite.noProjectRoles")}
          </span>
        ) : (
          <RoleSelect
            size="sm"
            className="w-36"
            roles={options}
            value={choice.unavailable ? choice.selected : choice.role}
            onChange={choice.select}
            placeholder={t("team:inviteModal.rolePlaceholder")}
            ariaLabel={t(
              "settings:workspaceResources.invite.projectRoleLabel",
              {
                project: project.name,
              },
            )}
          />
        )
      ) : null}
    </li>
  );
}

/**
 * "Invite" on a person resource: one invitation to the resource's email
 * address, with a workspace role and a role in each chosen project. The
 * projects the resource has tasks in (and `defaultProjectIds`) are
 * pre-selected. Which roles may be offered comes from the API (the caller's own
 * permissions, per project); the API enforces the same again on send.
 */
function ResourceInviteDialog({
  resource,
  workspaceId,
  onClose,
  onLinkInstead,
  canLink,
  defaultProjectIds,
}: Props) {
  const { t } = useTranslation();
  const emailDelivery = useInvitationEmailDelivery();
  const roleFieldId = useId();
  const inviteResource = useInviteResource(workspaceId);

  const workspaceRoles = useGetAssignableRoles(workspaceId);
  const projectsQuery = useResourceInviteDefaults(resource.id, true);
  const projects = projectsQuery.data ?? [];

  // What the user changed; everything else follows the defaults (the projects
  // the resource has tasks in, and `defaultProjectIds`, are ticked).
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  // The role each ticked project will get, reported by its row.
  const [projectRoles, setProjectRoles] = useState<
    Record<string, string | undefined>
  >({});
  // The last failure, with the inputs it was for: it is shown only while the
  // inputs are still those, so changing anything clears it.
  const [failure, setFailure] = useState<{
    code: string | undefined;
    text: string;
    inputs: string;
  } | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const isTicked = (projectId: string, hasAssignments: boolean) =>
    ticked[projectId] ??
    (hasAssignments || Boolean(defaultProjectIds?.includes(projectId)));
  const selectedProjects = projects.filter((project) =>
    isTicked(project.id, project.hasAssignments),
  );
  const onProjectRole = useCallback(
    (projectId: string, role: string | undefined) =>
      setProjectRoles((current) =>
        current[projectId] === role
          ? current
          : { ...current, [projectId]: role },
      ),
    [],
  );

  const workspaceRoleOptions = workspaceRoles.data?.map(
    (option) => option.role,
  );
  const workspaceChoice = useRoleChoice(workspaceRoleOptions);
  const workspaceRole = workspaceChoice.role;

  const everyProjectHasRole = selectedProjects.every(
    (project) => projectRoles[project.id],
  );
  const inputsKey = JSON.stringify([
    workspaceRole ?? null,
    selectedProjects.map((project) => [project.id, projectRoles[project.id]]),
  ]);
  const shownFailure = failure?.inputs === inputsKey ? failure : null;
  const canSubmit =
    Boolean(workspaceRole) &&
    selectedProjects.length > 0 &&
    everyProjectHasRole &&
    !inviteResource.isPending;

  const submit = async () => {
    if (!workspaceRole) return;
    setFailure(null);
    const body = selectedProjects.flatMap((project) => {
      const role = projectRoles[project.id];
      return role ? [{ projectId: project.id, role }] : [];
    });
    try {
      const invitation = await inviteResource.mutateAsync({
        id: resource.id,
        workspaceRole,
        projects: body,
      });
      // The API says what happened to the email. An extended invitation was
      // mailed before, so no second email goes out.
      const email = invitation.email;
      const message = !invitation.created
        ? t("settings:workspaceResources.invite.addedToExisting")
        : invitation.emailSent
          ? t("projectInvitations:invite.createdSent", { email })
          : invitation.emailAttempted
            ? t("projectInvitations:invite.createdSendFailed", { email })
            : t("projectInvitations:invite.createdNotSent", { email });
      toast.success(message);
      setCreated({ id: invitation.id, message });
    } catch (error) {
      const code = getResourceErrorCode(error);
      setFailure({
        code,
        // Somebody who cannot link is not sent to a link they cannot use.
        text:
          code === "ALREADY_WORKSPACE_MEMBER" && !canLink
            ? t("settings:workspaceResources.errors.alreadyWorkspaceMemberOnly")
            : getResourceErrorMessage(
                error,
                t,
                "settings:workspaceResources.invite.error",
              ),
        inputs: inputsKey,
      });
    }
  };

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
              <p className="text-sm text-muted-foreground">{created.message}</p>
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
                ) : workspaceChoice.isEmpty ? (
                  <p className="text-sm text-muted-foreground" role="status">
                    {t("team:inviteModal.noAssignableRoles")}
                  </p>
                ) : (
                  <>
                    <RoleSelect
                      id={roleFieldId}
                      roles={workspaceRoleOptions ?? []}
                      value={
                        workspaceChoice.unavailable
                          ? workspaceChoice.selected
                          : workspaceRole
                      }
                      onChange={workspaceChoice.select}
                      placeholder={t("team:inviteModal.rolePlaceholder")}
                    />
                    {workspaceChoice.unavailable ? (
                      <p className="text-sm text-destructive" role="alert">
                        {t("team:inviteModal.roleUnavailable")}
                      </p>
                    ) : workspaceChoice.needsExplicit ? (
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
                    {projects.map((project) => (
                      <ProjectInviteRow
                        key={project.id}
                        project={project}
                        checked={isTicked(project.id, project.hasAssignments)}
                        checkboxId={`${roleFieldId}-${project.id}`}
                        onCheckedChange={(next) =>
                          setTicked((current) => ({
                            ...current,
                            [project.id]: next,
                          }))
                        }
                        onRoleChange={onProjectRole}
                      />
                    ))}
                  </ul>
                )}
                {projects.length > 0 && selectedProjects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("settings:workspaceResources.invite.pickProject")}
                  </p>
                ) : null}
              </fieldset>

              {shownFailure ? (
                <Alert variant="error" role="alert">
                  <AlertDescription className="space-y-2">
                    <p>{shownFailure.text}</p>
                    {shownFailure.code === "ALREADY_WORKSPACE_MEMBER" &&
                    canLink ? (
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
