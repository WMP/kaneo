import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import useLinkResource from "@/hooks/mutations/resource/use-link-resource";
import useGetWorkspaceMembers from "@/hooks/queries/workspace/use-get-workspace-members";
import { getResourceErrorMessage } from "@/lib/resource-error";
import { toast } from "@/lib/toast";
import type Resource from "@/types/resource";

type Props = {
  resource: Resource;
  workspaceId: string;
  onClose: () => void;
};

/**
 * "Link to member" on a person resource: pick somebody who already is a member
 * of the workspace. Their account then holds the resource's assignments in the
 * projects they can open; the resource stays linked. The member list is the
 * one the caller may see (the API filters it).
 */
function ResourceLinkDialog({ resource, workspaceId, onClose }: Props) {
  const { t } = useTranslation();
  const fieldId = useId();
  const linkResource = useLinkResource();
  const members = useGetWorkspaceMembers({ workspaceId });
  const [userId, setUserId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const options = useMemo(
    () =>
      [...(members.data ?? [])].sort((a, b) =>
        a.user.name.localeCompare(b.user.name),
      ),
    [members.data],
  );
  const selected = options.find((member) => member.userId === userId);

  const submit = async () => {
    if (!userId) return;
    setErrorText(null);
    try {
      const { resource: linked, movedTaskCount } =
        await linkResource.mutateAsync({ id: resource.id, userId });
      toast.success(
        t("settings:workspaceResources.link.success", {
          name: linked.user?.name ?? selected?.user.name ?? resource.name,
          moved: movedTaskCount,
        }),
      );
      onClose();
    } catch (error) {
      setErrorText(
        getResourceErrorMessage(
          error,
          t,
          "settings:workspaceResources.link.error",
        ),
      );
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogPopup className="w-full max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("settings:workspaceResources.link.title", {
              name: resource.name,
            })}
          </DialogTitle>
          <DialogDescription>
            {t("settings:workspaceResources.link.description")}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={fieldId}>
              {t("settings:workspaceResources.link.memberLabel")}
            </Label>
            {members.isLoading ? (
              <p className="text-sm text-muted-foreground" role="status">
                {t("settings:workspaceResources.link.membersLoading")}
              </p>
            ) : members.isError ? (
              <p className="text-sm text-destructive" role="alert">
                {t("settings:workspaceResources.link.membersError")}
              </p>
            ) : options.length === 0 ? (
              <p className="text-sm text-muted-foreground" role="status">
                {t("settings:workspaceResources.link.noMembers")}
              </p>
            ) : (
              <Select
                value={userId}
                onValueChange={(next) => {
                  if (typeof next === "string") setUserId(next);
                }}
              >
                <SelectTrigger id={fieldId} className="w-full">
                  <SelectValue
                    placeholder={t(
                      "settings:workspaceResources.link.memberPlaceholder",
                    )}
                  >
                    {selected
                      ? `${selected.user.name} (${selected.user.email})`
                      : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {options.map((member) => (
                    <SelectItem key={member.userId} value={member.userId}>
                      {member.user.name} ({member.user.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground">
              {t("settings:workspaceResources.link.hint")}
            </p>
          </div>

          {errorText ? (
            <Alert variant="error" role="alert">
              <AlertDescription>{errorText}</AlertDescription>
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
            disabled={!userId || linkResource.isPending}
            aria-busy={linkResource.isPending}
          >
            {t("settings:workspaceResources.link.submit")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export default ResourceLinkDialog;
