import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { InfoIcon } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod/v4";
import useInviteWorkspaceUser from "@/hooks/mutations/workspace-user/use-invite-workspace-user";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import useGetAssignableRoles from "@/hooks/queries/workspace/use-get-assignable-roles";
import {
  getInvitationEmailMessageKey,
  useInvitationEmailDelivery,
} from "@/hooks/use-invitation-email-delivery";
import { useRoleChoice } from "@/hooks/use-role-choice";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";
import { getWorkspaceMemberErrorMessage } from "@/lib/workspace-role-error";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import InvitationLinkField from "./invitation-link-field";
import RoleSelect from "./role-select";

type Props = {
  open: boolean;
  onClose: () => void;
};

type TeamMemberFormValues = { email: string };

function InviteTeamMemberModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const { mutateAsync } = useInviteWorkspaceUser();
  const queryClient = useQueryClient();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { canInviteUsers } = useWorkspacePermission();
  const canInvite = canInviteUsers();
  const emailDelivery = useInvitationEmailDelivery();
  const showNoSmtpNotice = emailDelivery === "not-sent";
  const roleFieldId = useId();
  const {
    data: assignableRoles,
    isLoading: rolesLoading,
    isError: rolesFailed,
    refetch: refetchRoles,
  } = useGetAssignableRoles(workspaceId);
  // The modal stays mounted while closed, so the query's own refetch-on-mount
  // never fires when it opens. Refresh the list each time it opens: the
  // caller's permissions may have changed since it was last fetched.
  useEffect(() => {
    if (open && workspaceId) {
      void refetchRoles({ cancelRefetch: false });
    }
  }, [open, workspaceId, refetchRoles]);
  // Data can outlive a failed background refetch (isError with data): keep
  // using it. Only "no data at all" blocks the picker. The choice rules (only
  // `member` is ever picked for the user, a vanished pick is not replaced) live
  // in useRoleChoice, shared with the project invite dialogs.
  const roleOptions = assignableRoles ?? [];
  const roleNames = useMemo(
    () => assignableRoles?.map((option) => option.role),
    [assignableRoles],
  );
  const choice = useRoleChoice(roleNames);
  const {
    role,
    selected: selectedRole,
    select: setSelectedRole,
    hasData: hasRoleData,
    unavailable: selectedRoleUnavailable,
    needsExplicit: needsExplicitRole,
    isEmpty: hasNoAssignableRoles,
  } = choice;
  const [createdInvitation, setCreatedInvitation] = useState<{
    id: string;
    email: string;
  } | null>(null);

  const teamMemberSchema = useMemo(
    () =>
      z.object({
        email: z
          .string()
          .trim()
          .toLowerCase()
          .pipe(z.email(t("team:inviteModal.invalidEmail"))),
      }),
    [t],
  );

  const form = useForm<TeamMemberFormValues>({
    resolver: standardSchemaResolver(teamMemberSchema),
    defaultValues: {
      email: "",
    },
  });

  const onSubmit = async ({ email }: TeamMemberFormValues) => {
    if (!workspaceId) {
      toast.error(t("team:inviteModal.error"));
      return;
    }
    if (!canInvite) {
      // Defense-in-depth: parent gates the trigger, but if the modal is
      // somehow open without permission we refuse rather than firing a
      // mutation the server will reject.
      toast.error(t("team:inviteModal.error"));
      return;
    }
    if (!role) {
      toast.error(t("team:inviteModal.error"));
      return;
    }
    try {
      const invitation = await mutateAsync({
        email,
        workspaceId,
        role,
      });
      await queryClient.refetchQueries({
        queryKey: ["workspace-members", workspaceId],
      });

      toast.success(t(getInvitationEmailMessageKey("created", emailDelivery)));

      // The link is the only delivery channel when SMTP is unconfigured, so the
      // modal stays open on it instead of closing. If the API ever stops
      // returning an id, fall back to the previous close-on-success behaviour.
      if (invitation?.id) {
        setCreatedInvitation({ id: invitation.id, email });
        form.reset();
        setSelectedRole(null);
        return;
      }

      resetInviteTeamMember();
      onClose();
    } catch (error) {
      toast.error(
        getWorkspaceMemberErrorMessage(error, t, "team:inviteModal.error"),
      );
    }
  };

  const resetInviteTeamMember = async () => {
    if (workspaceId) {
      await queryClient.invalidateQueries({
        queryKey: ["workspace-members", workspaceId],
      });
    }
    form.reset();
    setSelectedRole(null);
  };

  const resetAndCloseModal = () => {
    setCreatedInvitation(null);
    resetInviteTeamMember();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={resetAndCloseModal}>
      <DialogPopup className="w-full max-w-md">
        <DialogHeader>
          <DialogTitle>
            {createdInvitation
              ? t("team:inviteModal.createdTitle")
              : t("team:inviteModal.title")}
          </DialogTitle>
        </DialogHeader>

        {createdInvitation ? (
          <>
            <DialogPanel className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t(getInvitationEmailMessageKey("shareLink", emailDelivery), {
                  email: createdInvitation.email,
                })}
              </p>
              <InvitationLinkField invitationId={createdInvitation.id} />
            </DialogPanel>
            <DialogFooter>
              <Button size="sm" onClick={resetAndCloseModal}>
                {t("team:inviteModal.done")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="contents">
              <DialogPanel className="space-y-4">
                {showNoSmtpNotice ? (
                  <Alert variant="info" role="status">
                    <InfoIcon />
                    <AlertDescription>
                      {t("team:inviteModal.noSmtpNotice")}
                    </AlertDescription>
                  </Alert>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {t("projectMembers:workspaceInvite.info")}{" "}
                  <Link
                    to="/dashboard/settings/projects"
                    onClick={onClose}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    {t("projectMembers:workspaceInvite.link")}
                  </Link>
                </p>
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("team:inviteModal.emailLabel")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t("team:inviteModal.emailPlaceholder")}
                          autoFocus
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="space-y-2">
                  <Label htmlFor={roleFieldId}>
                    {t("team:inviteModal.roleLabel")}
                  </Label>
                  {!workspaceId ? null : !hasRoleData && rolesLoading ? (
                    <p className="text-sm text-muted-foreground" role="status">
                      {t("team:inviteModal.rolesLoading")}
                    </p>
                  ) : !hasRoleData && rolesFailed ? (
                    <p className="text-sm text-destructive" role="alert">
                      {t("team:inviteModal.rolesError")}
                    </p>
                  ) : hasNoAssignableRoles ? (
                    <p className="text-sm text-muted-foreground" role="status">
                      {t("team:inviteModal.noAssignableRoles")}
                    </p>
                  ) : hasRoleData ? (
                    <>
                      <RoleSelect
                        id={roleFieldId}
                        roles={roleOptions.map((option) => option.role)}
                        value={selectedRoleUnavailable ? selectedRole : role}
                        onChange={setSelectedRole}
                        placeholder={t("team:inviteModal.rolePlaceholder")}
                      />
                      {selectedRoleUnavailable ? (
                        <p className="text-sm text-destructive" role="alert">
                          {t("team:inviteModal.roleUnavailable")}
                        </p>
                      ) : needsExplicitRole ? (
                        <p className="text-sm text-muted-foreground">
                          {t("team:inviteModal.rolePickRequired")}
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </div>
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
                  disabled={
                    !workspaceId ||
                    !canInvite ||
                    !role ||
                    form.formState.isSubmitting
                  }
                  aria-busy={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting
                    ? t("team:inviteModal.sending")
                    : t("team:inviteModal.sendInvitation")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogPopup>
    </Dialog>
  );
}

export default InviteTeamMemberModal;
