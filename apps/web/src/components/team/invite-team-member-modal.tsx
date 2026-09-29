import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useQueryClient } from "@tanstack/react-query";
import { InfoIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod/v4";
import useInviteWorkspaceUser from "@/hooks/mutations/workspace-user/use-invite-workspace-user";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import useGetAssignableRoles from "@/hooks/queries/workspace/use-get-assignable-roles";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";
import { getWorkspaceMemberErrorMessage } from "@/lib/workspace-role-error";
import { getWorkspaceRoleLabel } from "@/lib/workspace-role-label";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import InvitationLinkField from "./invitation-link-field";

type Props = {
  open: boolean;
  onClose: () => void;
};

// Preferred role for a new invitation. The API decides which roles the caller
// may grant, so this only applies when it is in that list.
const PREFERRED_INVITE_ROLE = "member";

type TeamMemberFormValues = { email: string };

function InviteTeamMemberModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const { mutateAsync } = useInviteWorkspaceUser();
  const queryClient = useQueryClient();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { canInviteUsers } = useWorkspacePermission();
  const canInvite = canInviteUsers();
  const { data: config } = useGetConfig();
  // Only an explicit `true` may promise an email: while the config is loading
  // or failed we do not know, so the copy must not claim one was sent.
  const emailsAreSent = config?.hasSmtp === true;
  const showNoSmtpNotice = config?.hasSmtp === false;
  const roleFieldId = useId();
  const {
    data: assignableRoles,
    isPending: rolesLoading,
    isError: rolesFailed,
  } = useGetAssignableRoles(workspaceId);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const roleOptions = assignableRoles ?? [];
  const defaultRole = roleOptions.some((r) => r.role === PREFERRED_INVITE_ROLE)
    ? PREFERRED_INVITE_ROLE
    : roleOptions[0]?.role;
  // A stale pick (the list changed under us) falls back to the default.
  const role =
    selectedRole && roleOptions.some((r) => r.role === selectedRole)
      ? selectedRole
      : defaultRole;
  const hasNoAssignableRoles =
    !rolesLoading && !rolesFailed && roleOptions.length === 0;
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
        queryKey: ["workspace-users", workspaceId],
      });

      toast.success(
        emailsAreSent
          ? t("team:inviteModal.success")
          : t("team:inviteModal.successNoEmail"),
      );

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
        queryKey: ["workspace-users", workspaceId],
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
                {emailsAreSent
                  ? t("team:inviteModal.shareLinkDescription", {
                      email: createdInvitation.email,
                    })
                  : t("team:inviteModal.shareLinkDescriptionNoEmail", {
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
                  {rolesLoading ? (
                    <p className="text-sm text-muted-foreground" role="status">
                      {t("team:inviteModal.rolesLoading")}
                    </p>
                  ) : rolesFailed ? (
                    <p className="text-sm text-destructive" role="alert">
                      {t("team:inviteModal.rolesError")}
                    </p>
                  ) : hasNoAssignableRoles ? (
                    <p className="text-sm text-muted-foreground" role="status">
                      {t("team:inviteModal.noAssignableRoles")}
                    </p>
                  ) : (
                    <Select
                      id={roleFieldId}
                      value={role}
                      onValueChange={(value) => {
                        if (typeof value === "string" && value) {
                          setSelectedRole(value);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue>
                          {role ? getWorkspaceRoleLabel(role, t) : null}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {roleOptions.map((option) => (
                          <SelectItem key={option.role} value={option.role}>
                            {getWorkspaceRoleLabel(option.role, t)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
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
                  disabled={!workspaceId || !canInvite || !role}
                >
                  {t("team:inviteModal.sendInvitation")}
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
