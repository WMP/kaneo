import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import useAddProjectMember from "@/hooks/mutations/project-member/use-add-project-member";
import useGetMemberCandidates from "@/hooks/queries/project-member/use-get-member-candidates";
import useGetProjectAssignableRoles from "@/hooks/queries/project-member/use-get-project-assignable-roles";
import { useRoleChoice } from "@/hooks/use-role-choice";
import { cn } from "@/lib/cn";
import { getProjectMemberErrorMessage } from "@/lib/project-member-error";
import { toast } from "@/lib/toast";
import RoleField from "./role-field";

type Props = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  workspaceId: string;
  /** Preselect a person and a role, for "Add as member" from the invite dialog. */
  initial?: { userId?: string; role?: string };
};

function AddProjectMemberDialog({
  open,
  onClose,
  projectId,
  workspaceId,
  initial,
}: Props) {
  const { t } = useTranslation();
  const memberFieldId = useId();
  const searchId = useId();
  const roleFieldId = useId();
  const {
    data: candidates,
    isLoading: candidatesLoading,
    isError: candidatesFailed,
    refetch: refetchCandidates,
  } = useGetMemberCandidates(projectId);
  const {
    data: assignableRoles,
    isLoading: rolesLoading,
    isError: rolesFailed,
    refetch: refetchRoles,
  } = useGetProjectAssignableRoles(projectId);
  const { mutateAsync: addMember, isPending } =
    useAddProjectMember(workspaceId);

  const roleNames = useMemo(
    () => assignableRoles?.map((role) => role.role),
    [assignableRoles],
  );
  const choice = useRoleChoice(roleNames);
  const { select: selectRole } = choice;
  const [userId, setUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // The dialog stays mounted while closed: read the lists again each time it
  // opens (people joined, roles changed) and start from the given preselection.
  const initialUserId = initial?.userId;
  const initialRole = initial?.role;
  // Held in a ref so a new function identity never re-runs the reset below.
  const refetchLists = useRef({ refetchCandidates, refetchRoles });
  refetchLists.current = { refetchCandidates, refetchRoles };
  useEffect(() => {
    if (!open) return;
    void refetchLists.current.refetchCandidates({ cancelRefetch: false });
    void refetchLists.current.refetchRoles({ cancelRefetch: false });
    setUserId(initialUserId ?? null);
    selectRole(initialRole ?? null);
    setSearch("");
  }, [open, initialUserId, initialRole, selectRole]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return candidates ?? [];
    return (candidates ?? []).filter(
      (candidate) =>
        candidate.name.toLowerCase().includes(needle) ||
        candidate.email.toLowerCase().includes(needle),
    );
  }, [candidates, search]);

  // A pick that left the list (added elsewhere meanwhile) is not submitted.
  const selectedCandidate = candidates?.find((c) => c.id === userId);
  const canSubmit = Boolean(selectedCandidate && choice.role) && !isPending;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedCandidate || !choice.role) return;
    try {
      await addMember({
        projectId,
        userId: selectedCandidate.id,
        role: choice.role,
      });
      toast.success(t("projectMembers:addDialog.success"));
      onClose();
    } catch (error) {
      toast.error(
        getProjectMemberErrorMessage(
          error,
          t,
          "projectMembers:addDialog.error",
        ),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPopup className="w-full max-w-md">
        <DialogHeader>
          <DialogTitle>{t("projectMembers:addDialog.title")}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t("projectMembers:addDialog.description")}
          </p>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="contents">
          <DialogPanel className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={searchId}>
                {t("projectMembers:addDialog.memberLabel")}
              </Label>
              {candidatesLoading && candidates === undefined ? (
                <p className="text-sm text-muted-foreground" role="status">
                  {t("projectMembers:addDialog.loading")}
                </p>
              ) : candidatesFailed && candidates === undefined ? (
                <p className="text-sm text-destructive" role="alert">
                  {t("projectMembers:addDialog.loadError")}
                </p>
              ) : candidates && candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground" role="status">
                  {t("projectMembers:addDialog.noCandidates")}
                </p>
              ) : (
                <>
                  <Input
                    id={searchId}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t(
                      "projectMembers:addDialog.searchPlaceholder",
                    )}
                    autoComplete="off"
                  />
                  <div
                    id={memberFieldId}
                    role="listbox"
                    aria-label={t("projectMembers:addDialog.memberLabel")}
                    className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border p-1"
                  >
                    {filtered.length === 0 ? (
                      <p className="px-2 py-3 text-sm text-muted-foreground">
                        {t("projectMembers:addDialog.noMatches")}
                      </p>
                    ) : (
                      filtered.map((candidate) => (
                        <button
                          key={candidate.id}
                          type="button"
                          role="option"
                          aria-selected={candidate.id === userId}
                          onClick={() => setUserId(candidate.id)}
                          className={cn(
                            "flex w-full flex-col rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                            candidate.id === userId && "bg-accent",
                          )}
                        >
                          <span className="font-medium">{candidate.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {candidate.email}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
            <RoleField
              id={roleFieldId}
              label={t("projectMembers:addDialog.roleLabel")}
              roles={roleNames}
              isLoading={rolesLoading}
              isError={rolesFailed}
              choice={choice}
              texts={{
                loading: t("projectMembers:addDialog.rolesLoading"),
                error: t("projectMembers:addDialog.rolesError"),
                none: t("projectMembers:addDialog.noAssignableRoles"),
                placeholder: t("projectMembers:addDialog.rolePlaceholder"),
                pickRequired: t("projectMembers:addDialog.rolePickRequired"),
                unavailable: t("projectMembers:addDialog.roleUnavailable"),
              }}
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
              disabled={!canSubmit}
              aria-busy={isPending}
            >
              {isPending
                ? t("projectMembers:addDialog.submitting")
                : t("projectMembers:addDialog.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

export default AddProjectMemberDialog;
