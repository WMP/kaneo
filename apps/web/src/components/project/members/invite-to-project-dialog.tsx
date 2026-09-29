import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { InfoIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod/v4";
import InvitationLinkField from "@/components/team/invitation-link-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import useCreateProjectInvitation from "@/hooks/mutations/project-invitation/use-create-project-invitation";
import useGetProjectAssignableRoles from "@/hooks/queries/project-member/use-get-project-assignable-roles";
import useGetAssignableRoles from "@/hooks/queries/workspace/use-get-assignable-roles";
import { useInvitationEmailDelivery } from "@/hooks/use-invitation-email-delivery";
import { useRoleChoice } from "@/hooks/use-role-choice";
import { getProjectMemberErrorMessage } from "@/lib/project-member-error";
import { toast } from "@/lib/toast";
import { readCode } from "@/lib/workspace-role-error";
import RoleField from "./role-field";

type Candidate = { id: string; email: string };

type Props = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  workspaceId: string;
  /** Start from an existing invitation, for "Invite again". */
  prefill?: { email?: string; workspaceRole?: string; projectRole?: string };
  /** Workspace members who can be added directly, to offer "Add as member". */
  candidates?: Candidate[];
  onAddExistingMember?: (member: { userId: string; role: string }) => void;
};

type FormValues = { email: string };

type Created = {
  id: string;
  email: string;
  message: string;
};

function InviteToProjectDialog({
  open,
  onClose,
  projectId,
  workspaceId,
  prefill,
  candidates,
  onAddExistingMember,
}: Props) {
  const { t } = useTranslation();
  const workspaceRoleId = useId();
  const projectRoleId = useId();
  const emailDelivery = useInvitationEmailDelivery();
  const { mutateAsync: createInvitation } =
    useCreateProjectInvitation(workspaceId);
  const {
    data: workspaceRoles,
    isLoading: workspaceRolesLoading,
    isError: workspaceRolesFailed,
    refetch: refetchWorkspaceRoles,
  } = useGetAssignableRoles(workspaceId);
  const {
    data: projectRoles,
    isLoading: projectRolesLoading,
    isError: projectRolesFailed,
    refetch: refetchProjectRoles,
  } = useGetProjectAssignableRoles(projectId);

  const workspaceRoleNames = useMemo(
    () => workspaceRoles?.map((role) => role.role),
    [workspaceRoles],
  );
  const projectRoleNames = useMemo(
    () => projectRoles?.map((role) => role.role),
    [projectRoles],
  );
  const workspaceChoice = useRoleChoice(workspaceRoleNames);
  const projectChoice = useRoleChoice(projectRoleNames);
  const { select: selectWorkspaceRole } = workspaceChoice;
  const { select: selectProjectRole } = projectChoice;
  const [created, setCreated] = useState<Created | null>(null);
  // Set when the API says the person already is a workspace member.
  const [alreadyMemberEmail, setAlreadyMemberEmail] = useState<string | null>(
    null,
  );

  const schema = useMemo(
    () =>
      z.object({
        email: z
          .string()
          .trim()
          .toLowerCase()
          .pipe(z.email(t("projectInvitations:invite.invalidEmail"))),
      }),
    [t],
  );
  const form = useForm<FormValues>({
    resolver: standardSchemaResolver(schema),
    defaultValues: { email: "" },
  });
  const { reset: resetForm } = form;

  // The dialog stays mounted while closed: read the role lists again each time
  // it opens, since the caller's permissions may have changed.
  const prefillEmail = prefill?.email;
  const prefillWorkspaceRole = prefill?.workspaceRole;
  const prefillProjectRole = prefill?.projectRole;
  // Held in a ref so a new function identity never re-runs the reset below.
  const refetchRoles = useRef({ refetchWorkspaceRoles, refetchProjectRoles });
  refetchRoles.current = { refetchWorkspaceRoles, refetchProjectRoles };
  useEffect(() => {
    if (!open) return;
    void refetchRoles.current.refetchWorkspaceRoles({ cancelRefetch: false });
    void refetchRoles.current.refetchProjectRoles({ cancelRefetch: false });
    resetForm({ email: prefillEmail ?? "" });
    selectWorkspaceRole(prefillWorkspaceRole ?? null);
    selectProjectRole(prefillProjectRole ?? null);
    setCreated(null);
    setAlreadyMemberEmail(null);
  }, [
    open,
    prefillEmail,
    prefillWorkspaceRole,
    prefillProjectRole,
    resetForm,
    selectWorkspaceRole,
    selectProjectRole,
  ]);

  const canSend =
    Boolean(workspaceChoice.role && projectChoice.role) &&
    !form.formState.isSubmitting;

  const onSubmit = async ({ email }: FormValues) => {
    const workspaceRole = workspaceChoice.role;
    const projectRole = projectChoice.role;
    if (!workspaceRole || !projectRole) return;
    setAlreadyMemberEmail(null);
    try {
      const result = await createInvitation({
        projectId,
        email,
        workspaceRole,
        projectRole,
      });
      const { invitation } = result;
      // The API says what happened to the email. An extended invitation was
      // mailed before, so no second email goes out.
      const message = !result.created
        ? t("projectInvitations:invite.addedToExisting", { email })
        : invitation.emailSent
          ? t("projectInvitations:invite.createdSent", { email })
          : invitation.emailAttempted
            ? t("projectInvitations:invite.createdSendFailed", { email })
            : t("projectInvitations:invite.createdNotSent", { email });
      toast.success(message);
      setCreated({ id: invitation.id, email, message });
      form.reset({ email: "" });
    } catch (error) {
      if (readCode(error) === "ALREADY_WORKSPACE_MEMBER") {
        setAlreadyMemberEmail(email);
        return;
      }
      toast.error(
        getProjectMemberErrorMessage(
          error,
          t,
          "projectInvitations:invite.error",
        ),
      );
    }
  };

  const existingMember = alreadyMemberEmail
    ? candidates?.find(
        (candidate) =>
          candidate.email.toLowerCase() === alreadyMemberEmail.toLowerCase(),
      )
    : undefined;
  const addAsMemberRole = projectChoice.role;

  const workspaceRoleTexts = {
    loading: t("projectInvitations:invite.workspaceRolesLoading"),
    error: t("projectInvitations:invite.workspaceRolesError"),
    none: t("projectInvitations:invite.noAssignableWorkspaceRoles"),
    placeholder: t("projectInvitations:invite.rolePlaceholder"),
    pickRequired: t("projectInvitations:invite.workspaceRolePickRequired"),
    unavailable: t("projectInvitations:invite.workspaceRoleUnavailable"),
  };
  const projectRoleTexts = {
    loading: t("projectInvitations:invite.projectRolesLoading"),
    error: t("projectInvitations:invite.projectRolesError"),
    none: t("projectInvitations:invite.noAssignableProjectRoles"),
    placeholder: t("projectInvitations:invite.rolePlaceholder"),
    pickRequired: t("projectInvitations:invite.projectRolePickRequired"),
    unavailable: t("projectInvitations:invite.projectRoleUnavailable"),
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPopup className="w-full max-w-md">
        <DialogHeader>
          <DialogTitle>
            {created
              ? t("projectInvitations:invite.createdTitle")
              : t("projectInvitations:invite.title")}
          </DialogTitle>
        </DialogHeader>

        {created ? (
          <>
            <DialogPanel className="space-y-3">
              <p className="text-sm text-muted-foreground" role="status">
                {created.message}
              </p>
              <InvitationLinkField invitationId={created.id} />
            </DialogPanel>
            <DialogFooter>
              <Button size="sm" onClick={onClose}>
                {t("projectInvitations:invite.done")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="contents">
              <DialogPanel className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {t("projectInvitations:invite.description")}
                </p>
                {emailDelivery === "not-sent" ? (
                  <Alert variant="info" role="status">
                    <InfoIcon />
                    <AlertDescription>
                      {t("projectInvitations:invite.noSmtpNotice")}
                    </AlertDescription>
                  </Alert>
                ) : null}
                {alreadyMemberEmail ? (
                  <Alert variant="warning" role="alert">
                    <InfoIcon />
                    <AlertDescription className="space-y-2">
                      <p>
                        {t("projectInvitations:errors.alreadyWorkspaceMember")}
                      </p>
                      {existingMember &&
                      onAddExistingMember &&
                      addAsMemberRole ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() =>
                            onAddExistingMember({
                              userId: existingMember.id,
                              role: addAsMemberRole,
                            })
                          }
                        >
                          {t("projectInvitations:invite.addAsMember")}
                        </Button>
                      ) : null}
                    </AlertDescription>
                  </Alert>
                ) : null}
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("projectInvitations:invite.emailLabel")}
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          onChange={(event) => {
                            // A new address makes the warning about the old
                            // one (and its "Add as member") stale.
                            setAlreadyMemberEmail(null);
                            field.onChange(event);
                          }}
                          placeholder={t(
                            "projectInvitations:invite.emailPlaceholder",
                          )}
                          autoFocus
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <RoleField
                  id={workspaceRoleId}
                  label={t("projectInvitations:invite.workspaceRoleLabel")}
                  hint={t("projectInvitations:invite.workspaceRoleHint")}
                  roles={workspaceRoleNames}
                  isLoading={workspaceRolesLoading}
                  isError={workspaceRolesFailed}
                  choice={workspaceChoice}
                  texts={workspaceRoleTexts}
                />
                <RoleField
                  id={projectRoleId}
                  label={t("projectInvitations:invite.projectRoleLabel")}
                  hint={t("projectInvitations:invite.projectRoleHint")}
                  roles={projectRoleNames}
                  isLoading={projectRolesLoading}
                  isError={projectRolesFailed}
                  choice={projectChoice}
                  texts={projectRoleTexts}
                />
              </DialogPanel>
              <DialogFooter>
                <DialogClose
                  render={<Button variant="outline" size="sm" type="button" />}
                >
                  {t("common:actions.cancel")}
                </DialogClose>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!canSend}
                  aria-busy={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting
                    ? t("projectInvitations:invite.submitting")
                    : t("projectInvitations:invite.submit")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogPopup>
    </Dialog>
  );
}

export default InviteToProjectDialog;
