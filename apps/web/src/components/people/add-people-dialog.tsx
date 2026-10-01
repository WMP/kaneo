import { InfoIcon, MailPlusIcon, SearchIcon, UserPlusIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import useCreateProjectInvitation from "@/hooks/mutations/project-invitation/use-create-project-invitation";
import useAddProjectMember from "@/hooks/mutations/project-member/use-add-project-member";
import useAddWorkspaceMember from "@/hooks/mutations/workspace/use-add-workspace-member";
import useInviteWorkspaceUser from "@/hooks/mutations/workspace-user/use-invite-workspace-user";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import useGetMemberCandidates from "@/hooks/queries/project-member/use-get-member-candidates";
import useGetProjectAssignableRoles from "@/hooks/queries/project-member/use-get-project-assignable-roles";
import useGetAssignableRoles from "@/hooks/queries/workspace/use-get-assignable-roles";
import useSearchUserDirectory, {
  USER_DIRECTORY_MIN_QUERY_LENGTH,
} from "@/hooks/queries/workspace/use-search-user-directory";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  getInvitationEmailMessageKey,
  useInvitationEmailDelivery,
} from "@/hooks/use-invitation-email-delivery";
import { useRoleChoice } from "@/hooks/use-role-choice";
import { cn } from "@/lib/cn";
import {
  getProjectMemberErrorMessage,
  ProjectMemberError,
} from "@/lib/project-member-error";
import { toast } from "@/lib/toast";
import {
  getWorkspaceMemberErrorMessage,
  readCode,
} from "@/lib/workspace-role-error";
import PersonCell from "./person-cell";
import RoleField from "./role-field";

export type AddPeopleContext =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "project"; workspaceId: string; projectId: string };

type Props = {
  open: boolean;
  onClose: () => void;
  context: AddPeopleContext;
  /**
   * The caller may add an existing account without an invitation: in a
   * workspace `member:create` in the workspace role, in a project
   * `member:create` in the project role.
   */
  canAdd: boolean;
  /** The caller may send an invitation by email. */
  canInvite: boolean;
  /**
   * Project context only: the caller may also add accounts to the WORKSPACE
   * (`member:create` in the workspace role), which adding a person who is not
   * in the workspace yet needs.
   */
  canAddToWorkspace?: boolean;
  /** Start from an existing invitation, for "Invite again". */
  prefill?: { email?: string; workspaceRole?: string; projectRole?: string };
};

type Person = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

// What was picked. `candidate`: a workspace member without access to this
// project (project context). `directory`: an account that is not in the
// workspace (needs a workspace role). `email`: nobody matched, invite.
type Selection =
  | { kind: "candidate"; person: Person }
  | { kind: "directory"; person: Person }
  | { kind: "email"; email: string };

type Created = { id: string; email: string; message: string };

const emailSchema = z.email();

function isEmail(value: string): boolean {
  return emailSchema.safeParse(value).success;
}

function matches(person: Person, needle: string): boolean {
  return (
    person.name.toLowerCase().includes(needle) ||
    person.email.toLowerCase().includes(needle)
  );
}

const DEBOUNCE_MS = 250;

/**
 * The one dialog to bring people into a workspace or a project: a single field
 * for a name or an email. Matching accounts appear as you type (workspace
 * members without project access, and, where the instance and the caller's
 * rights allow it, every account of the instance). Picking one asks for the
 * role(s) and adds the person at once. An address nobody matches can be
 * invited by email instead, with the copyable link afterwards.
 */
function AddPeopleDialog({
  open,
  onClose,
  context,
  canAdd,
  canInvite,
  canAddToWorkspace = false,
  prefill,
}: Props) {
  const { t } = useTranslation();
  const isProject = context.kind === "project";
  const { workspaceId } = context;
  const projectId = context.kind === "project" ? context.projectId : undefined;

  const searchId = useId();
  const listboxId = useId();
  const workspaceRoleId = useId();
  const projectRoleId = useId();
  const emailDelivery = useInvitationEmailDelivery();
  const { data: config } = useGetConfig();
  const directoryEnabled = config?.userDirectoryEnabled === true;
  // Who may use the directory: adding an account that is not in the workspace
  // needs member:create in the workspace role (in a project, on top of adding
  // to the project).
  const mayUseDirectory =
    directoryEnabled && canAdd && (isProject ? canAddToWorkspace : true);

  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Set when the API says the person already is a workspace member.
  const [alreadyMemberEmail, setAlreadyMemberEmail] = useState<string | null>(
    null,
  );

  // Opening starts from nothing typed, picked or created. It is done while
  // rendering, before anything is committed, so the first render of an open
  // dialog never asks the directory about the text of the last time.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setSelection(null);
      setCreated(null);
      setAlreadyMemberEmail(null);
    }
  }

  // (The render that notices the opening already reads the text as empty.)
  const trimmed = (open && !wasOpen ? "" : query).trim();
  // Reset when the dialog opens: nothing typed before may be searched again.
  const debounced = useDebouncedValue(trimmed, DEBOUNCE_MS, open);
  const searchable = trimmed.length >= USER_DIRECTORY_MIN_QUERY_LENGTH;

  const directory = useSearchUserDirectory(workspaceId, debounced, {
    enabled: open && mayUseDirectory && selection === null,
  });
  const {
    data: candidates,
    isLoading: candidatesLoading,
    isError: candidatesFailed,
    refetch: refetchCandidates,
  } = useGetMemberCandidates(projectId, {
    enabled: open && isProject && canAdd,
  });
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
  } = useGetProjectAssignableRoles(projectId, { enabled: isProject });

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

  const { mutateAsync: addWorkspaceMember } = useAddWorkspaceMember();
  const { mutateAsync: addProjectMember } = useAddProjectMember(workspaceId);
  const { mutateAsync: inviteWorkspaceUser } = useInviteWorkspaceUser();
  const { mutateAsync: createProjectInvitation } =
    useCreateProjectInvitation(workspaceId);

  // The dialog stays mounted while closed: read the lists again each time it
  // opens (people joined, roles changed) and start from the given prefill.
  const prefillEmail = prefill?.email;
  const prefillWorkspaceRole = prefill?.workspaceRole;
  const prefillProjectRole = prefill?.projectRole;
  // Held in a ref so a new function identity never re-runs the reset below.
  const refetchLists = useRef({
    refetchCandidates,
    refetchWorkspaceRoles,
    refetchProjectRoles,
    canAdd,
  });
  refetchLists.current = {
    refetchCandidates,
    refetchWorkspaceRoles,
    refetchProjectRoles,
    canAdd,
  };
  useEffect(() => {
    // Nothing is reset while closing (the close animation would flip back to
    // the empty form); the reset happens when the dialog opens.
    if (!open) return;
    void refetchLists.current.refetchWorkspaceRoles({ cancelRefetch: false });
    if (isProject) {
      void refetchLists.current.refetchProjectRoles({ cancelRefetch: false });
      if (refetchLists.current.canAdd) {
        void refetchLists.current.refetchCandidates({ cancelRefetch: false });
      }
    }
    setQuery(prefillEmail ?? "");
    setSelection(
      prefillEmail && isEmail(prefillEmail.trim().toLowerCase())
        ? { kind: "email", email: prefillEmail.trim().toLowerCase() }
        : null,
    );
    selectWorkspaceRole(prefillWorkspaceRole ?? null);
    selectProjectRole(prefillProjectRole ?? null);
    setCreated(null);
    setAlreadyMemberEmail(null);
    setIsSubmitting(false);
  }, [
    open,
    isProject,
    prefillEmail,
    prefillWorkspaceRole,
    prefillProjectRole,
    selectWorkspaceRole,
    selectProjectRole,
  ]);

  // --- Suggestions ---------------------------------------------------------

  const needle = trimmed.toLowerCase();
  const candidateSuggestions = useMemo(
    () =>
      canAdd && isProject
        ? (candidates ?? []).filter(
            (candidate) => !needle || matches(candidate, needle),
          )
        : [],
    [canAdd, isProject, candidates, needle],
  );
  // The directory answer belongs to `debounced`; until it catches up with what
  // is typed (still debouncing, fetching, or showing the previous query's
  // placeholder), nothing of it is offered or selectable and "no match" is not
  // known yet.
  const directoryPending =
    mayUseDirectory &&
    searchable &&
    (debounced !== trimmed ||
      directory.isFetching ||
      Boolean(directory.isPlaceholderData));
  const directorySuggestions = useMemo(() => {
    if (!mayUseDirectory || !searchable || directoryPending) return [];
    const known = new Set(candidateSuggestions.map((c) => c.id));
    return (directory.data ?? []).filter((person) => !known.has(person.id));
  }, [
    mayUseDirectory,
    searchable,
    directoryPending,
    directory.data,
    candidateSuggestions,
  ]);
  const typedEmail = trimmed.toLowerCase();
  const emailMatchesSuggestion = [
    ...candidateSuggestions,
    ...directorySuggestions,
  ].some((person) => person.email.toLowerCase() === typedEmail);
  const showInviteOption =
    canInvite &&
    isEmail(typedEmail) &&
    !emailMatchesSuggestion &&
    !directoryPending;

  const hasOptions =
    candidateSuggestions.length > 0 ||
    directorySuggestions.length > 0 ||
    showInviteOption;

  const pick = (next: Selection) => {
    setSelection(next);
    setAlreadyMemberEmail(null);
  };

  // Every offered option in display order, for the keyboard.
  const options: Selection[] = [
    ...candidateSuggestions.map((person) => ({
      kind: "candidate" as const,
      person,
    })),
    ...directorySuggestions.map((person) => ({
      kind: "directory" as const,
      person,
    })),
    ...(showInviteOption
      ? [{ kind: "email" as const, email: typedEmail }]
      : []),
  ];
  const [activeIndex, setActiveIndex] = useState(-1);
  // The offered list changed under the highlight: start again.
  const optionsSignature = options
    .map((option) =>
      option.kind === "email"
        ? `e:${option.email}`
        : `${option.kind}:${option.person.id}`,
    )
    .join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on a changed list
  useEffect(() => setActiveIndex(-1), [optionsSignature]);
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  // --- What the picked person needs ---------------------------------------

  // A person who is not in the workspace yet gets a workspace role; in a
  // project everybody gets a project role.
  const needsWorkspaceRole =
    selection !== null && selection.kind !== "candidate";
  const needsProjectRole = isProject && selection !== null;
  // A pick that left the list (added elsewhere meanwhile) is not submitted.
  const candidateStillListed =
    selection?.kind !== "candidate" ||
    (candidates ?? []).some(
      (candidate) => candidate.id === selection.person.id,
    );
  const isInvite = selection?.kind === "email";
  const mayProceed = selection
    ? isInvite
      ? canInvite
      : selection.kind === "directory"
        ? canAdd && (isProject ? canAddToWorkspace : true)
        : canAdd
    : false;
  const canSubmit =
    selection !== null &&
    mayProceed &&
    candidateStillListed &&
    (!needsWorkspaceRole || Boolean(workspaceChoice.role)) &&
    (!needsProjectRole || Boolean(projectChoice.role)) &&
    !isSubmitting;

  // --- Submit --------------------------------------------------------------

  const addedMessage = (
    name: string,
    result: { emailAttempted?: boolean; emailSent?: boolean } | undefined,
  ) => {
    if (result?.emailSent) {
      toast.success(t("people:add.addedEmailed", { name }));
    } else if (result?.emailAttempted) {
      toast.warning(t("people:add.addedEmailFailed", { name }));
    } else {
      toast.success(t("people:add.added", { name }));
    }
  };

  const errorMessage = (
    error: unknown,
    fallbackKey: string,
    { adding = false }: { adding?: boolean } = {},
  ) => {
    const code = readCode(error);
    // In a workspace "add them to the project" makes no sense.
    if (code === "ALREADY_WORKSPACE_MEMBER" && !isProject) {
      return t("team:errors.alreadyMember");
    }
    // The add limit is not the invitation limit the shared mapper talks about.
    if (code === "RATE_LIMITED" && adding) {
      return t("people:errors.addRateLimited");
    }
    return error instanceof ProjectMemberError
      ? getProjectMemberErrorMessage(error, t, fallbackKey)
      : getWorkspaceMemberErrorMessage(error, t, fallbackKey);
  };

  // Why the directory search failed, in words: switched off, a guest account,
  // too many searches, or an ordinary failure.
  const searchErrorMessage = (error: unknown) =>
    readCode(error) === "RATE_LIMITED"
      ? t("people:errors.searchRateLimited")
      : getProjectMemberErrorMessage(error, t, "people:add.searchError");

  const submitAdd = async (
    chosen: Extract<Selection, { kind: "candidate" | "directory" }>,
  ) => {
    const workspaceRole = workspaceChoice.role;
    const projectRole = projectChoice.role;
    if (chosen.kind === "candidate") {
      if (!projectRole) return;
      const result = await addProjectMember({
        projectId: projectId ?? "",
        userId: chosen.person.id,
        role: projectRole,
      });
      addedMessage(chosen.person.name, result);
      return;
    }
    if (!workspaceRole) return;
    if (isProject) {
      if (!projectRole) return;
      const result = await addProjectMember({
        projectId: projectId ?? "",
        userId: chosen.person.id,
        role: projectRole,
        workspaceRole,
      });
      addedMessage(chosen.person.name, result);
      return;
    }
    const result = await addWorkspaceMember({
      workspaceId,
      userId: chosen.person.id,
      role: workspaceRole,
    });
    addedMessage(chosen.person.name, result);
  };

  const submitInvite = async (email: string) => {
    const workspaceRole = workspaceChoice.role;
    const projectRole = projectChoice.role;
    if (!workspaceRole) return;
    if (isProject) {
      if (!projectRole) return;
      const result = await createProjectInvitation({
        projectId: projectId ?? "",
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
      return;
    }
    const invitation = await inviteWorkspaceUser({
      email,
      workspaceId,
      role: workspaceRole,
    });
    toast.success(t(getInvitationEmailMessageKey("created", emailDelivery)));
    // The link is the only delivery channel when SMTP is unconfigured, so the
    // dialog stays open on it instead of closing. If the API ever stops
    // returning an id, fall back to closing.
    if (invitation?.id) {
      setCreated({
        id: invitation.id,
        email,
        message: t(getInvitationEmailMessageKey("shareLink", emailDelivery), {
          email,
        }),
      });
      return;
    }
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selection || !canSubmit) return;
    setIsSubmitting(true);
    setAlreadyMemberEmail(null);
    try {
      if (selection.kind === "email") {
        await submitInvite(selection.email);
      } else {
        await submitAdd(selection);
        onClose();
      }
    } catch (error) {
      const code = readCode(error);
      if (
        selection.kind === "email" &&
        (code === "ALREADY_WORKSPACE_MEMBER" ||
          code === "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION")
      ) {
        setAlreadyMemberEmail(selection.email);
        setSelection(null);
        return;
      }
      toast.error(
        errorMessage(
          error,
          selection.kind === "email"
            ? "people:add.inviteError"
            : "people:add.addError",
          { adding: selection.kind !== "email" },
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const existingMember = alreadyMemberEmail
    ? (candidates ?? []).find(
        (candidate) =>
          candidate.email.toLowerCase() === alreadyMemberEmail.toLowerCase(),
      )
    : undefined;

  // --- Texts ---------------------------------------------------------------

  const workspaceRoleTexts = {
    loading: t("people:add.roles.workspaceLoading"),
    error: t("people:add.roles.workspaceError"),
    none: t("people:add.roles.workspaceNone"),
    placeholder: t("people:add.roles.placeholder"),
    pickRequired: t("people:add.roles.workspacePickRequired"),
    unavailable: t("people:add.roles.workspaceUnavailable"),
  };
  const projectRoleTexts = {
    loading: t("people:add.roles.projectLoading"),
    error: t("people:add.roles.projectError"),
    none: t("people:add.roles.projectNone"),
    placeholder: t("people:add.roles.placeholder"),
    pickRequired: t("people:add.roles.projectPickRequired"),
    unavailable: t("people:add.roles.projectUnavailable"),
  };

  const submitLabel = isInvite
    ? isSubmitting
      ? t("people:add.sending")
      : t("people:add.sendInvitation")
    : isSubmitting
      ? t("people:add.adding")
      : t("people:add.add");

  const showSearching =
    searchable && directoryPending && directorySuggestions.length === 0;
  // A search that failed (switched off, a guest account, too many searches) did
  // not find that nobody matches: its own message is all that is shown.
  const searchFailed = mayUseDirectory && searchable && directory.isError;
  const showNoMatches =
    searchable &&
    !hasOptions &&
    !searchFailed &&
    !directoryPending &&
    !(isProject && canAdd && candidatesLoading && candidates === undefined);
  const showTypeHint =
    !searchable &&
    !hasOptions &&
    !(isProject && canAdd && candidatesLoading && candidates === undefined);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPopup className="w-full max-w-md">
        <DialogHeader>
          <DialogTitle>
            {created
              ? t("team:inviteModal.createdTitle")
              : t("people:add.title")}
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
                {t("team:inviteModal.done")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="contents">
            <DialogPanel className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("people:add.description")}
              </p>

              {alreadyMemberEmail ? (
                <Alert variant="warning" role="alert">
                  <InfoIcon />
                  <AlertDescription className="space-y-2">
                    <p>
                      {isProject
                        ? t("projectInvitations:errors.alreadyWorkspaceMember")
                        : t("team:errors.alreadyMember")}
                    </p>
                    {existingMember ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          pick({ kind: "candidate", person: existingMember });
                        }}
                      >
                        {t("projectInvitations:invite.addAsMember")}
                      </Button>
                    ) : null}
                  </AlertDescription>
                </Alert>
              ) : null}

              {selection ? (
                <div className="space-y-2">
                  <Label>{t("people:add.selectedLabel")}</Label>
                  <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                    {selection.kind === "email" ? (
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <MailPlusIcon className="size-4" />
                        </div>
                        <span className="truncate text-sm font-medium">
                          {selection.email}
                        </span>
                      </div>
                    ) : (
                      <PersonCell
                        name={selection.person.name}
                        email={selection.person.email}
                        image={selection.person.image}
                        compact
                      />
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => setSelection(null)}
                    >
                      {t("people:add.change")}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {selection.kind === "email"
                      ? t("people:add.willInvite", { email: selection.email })
                      : t("people:add.willAdd")}
                  </p>
                  {isInvite && emailDelivery === "not-sent" ? (
                    <Alert variant="info" role="status">
                      <InfoIcon />
                      <AlertDescription>
                        {t("team:inviteModal.noSmtpNotice")}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor={searchId}>{t("people:add.fieldLabel")}</Label>
                  <div className="relative">
                    <SearchIcon className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground" />
                    <Input
                      id={searchId}
                      role="combobox"
                      aria-expanded={hasOptions}
                      aria-controls={hasOptions ? listboxId : undefined}
                      aria-autocomplete="list"
                      aria-activedescendant={
                        hasOptions && activeIndex >= 0
                          ? optionId(activeIndex)
                          : undefined
                      }
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setAlreadyMemberEmail(null);
                      }}
                      onKeyDown={(event) => {
                        if (
                          event.key === "ArrowDown" ||
                          event.key === "ArrowUp"
                        ) {
                          if (options.length === 0) return;
                          event.preventDefault();
                          const step = event.key === "ArrowDown" ? 1 : -1;
                          setActiveIndex((current) =>
                            current < 0
                              ? step === 1
                                ? 0
                                : options.length - 1
                              : (current + step + options.length) %
                                options.length,
                          );
                          return;
                        }
                        if (event.key !== "Enter") return;
                        // Enter picks the highlighted suggestion, else the
                        // first one, and never submits. Only what is offered
                        // for the text as it stands can be picked.
                        event.preventDefault();
                        if (!trimmed) return;
                        const chosen =
                          options[activeIndex >= 0 ? activeIndex : 0];
                        if (chosen) pick(chosen);
                      }}
                      placeholder={t("people:add.placeholder")}
                      autoComplete="off"
                      autoFocus
                      className="ps-8"
                    />
                  </div>

                  {candidatesFailed && candidates === undefined ? (
                    <div
                      role="alert"
                      className="flex items-center justify-between gap-3 text-sm text-destructive"
                    >
                      <span>{t("people:add.loadError")}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => {
                          void refetchCandidates();
                        }}
                      >
                        {t("people:add.retry")}
                      </Button>
                    </div>
                  ) : null}

                  {mayUseDirectory && directory.isError && searchable ? (
                    <p className="text-sm text-destructive" role="alert">
                      {searchErrorMessage(directory.error)}
                    </p>
                  ) : null}

                  {hasOptions ? (
                    <div
                      id={listboxId}
                      role="listbox"
                      aria-label={t("people:add.suggestions")}
                      className="max-h-64 space-y-0.5 overflow-y-auto rounded-md border p-1"
                    >
                      {candidateSuggestions.length > 0 ? (
                        // biome-ignore lint/a11y/useSemanticElements: a group of options inside a listbox cannot be a fieldset
                        <div
                          role="group"
                          aria-label={t("people:add.groups.workspace")}
                        >
                          <p
                            aria-hidden="true"
                            className="px-2 py-1 text-xs font-medium text-muted-foreground"
                          >
                            {t("people:add.groups.workspace")}
                          </p>
                          {candidateSuggestions.map((person, index) => (
                            <SuggestionOption
                              key={`c-${person.id}`}
                              id={optionId(index)}
                              active={activeIndex === index}
                              onHover={() => setActiveIndex(index)}
                              person={person}
                              onPick={() => pick({ kind: "candidate", person })}
                            />
                          ))}
                        </div>
                      ) : null}
                      {directorySuggestions.length > 0 ? (
                        // biome-ignore lint/a11y/useSemanticElements: a group of options inside a listbox cannot be a fieldset
                        <div
                          role="group"
                          aria-label={t("people:add.groups.directory")}
                        >
                          <p
                            aria-hidden="true"
                            className="px-2 py-1 text-xs font-medium text-muted-foreground"
                          >
                            {t("people:add.groups.directory")}
                          </p>
                          {directorySuggestions.map((person, index) => {
                            const position =
                              candidateSuggestions.length + index;
                            return (
                              <SuggestionOption
                                key={`d-${person.id}`}
                                id={optionId(position)}
                                active={activeIndex === position}
                                onHover={() => setActiveIndex(position)}
                                person={person}
                                onPick={() =>
                                  pick({ kind: "directory", person })
                                }
                              />
                            );
                          })}
                        </div>
                      ) : null}
                      {showInviteOption ? (
                        <div
                          id={optionId(options.length - 1)}
                          role="option"
                          tabIndex={-1}
                          aria-selected={activeIndex === options.length - 1}
                          onMouseMove={() => setActiveIndex(options.length - 1)}
                          onClick={() =>
                            pick({ kind: "email", email: typedEmail })
                          }
                          onKeyDown={() => undefined}
                          className={cn(
                            "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                            activeIndex === options.length - 1 && "bg-accent",
                          )}
                        >
                          <MailPlusIcon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {t("people:add.inviteOption", {
                                email: typedEmail,
                              })}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {t("people:add.inviteOptionHint")}
                            </span>
                          </span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {showSearching ? (
                    <p className="text-sm text-muted-foreground" role="status">
                      {t("people:add.searching")}
                    </p>
                  ) : showNoMatches ? (
                    <p className="text-sm text-muted-foreground" role="status">
                      {canInvite
                        ? t("people:add.noMatchesInvite")
                        : t("people:add.noMatches")}
                    </p>
                  ) : showTypeHint ? (
                    <p className="text-xs text-muted-foreground">
                      {mayUseDirectory
                        ? canInvite
                          ? t("people:add.hintSearchOrInvite")
                          : t("people:add.hintSearch")
                        : canInvite
                          ? t("people:add.hintInviteOnly")
                          : t("people:add.hintNothing")}
                    </p>
                  ) : null}
                </div>
              )}

              {selection && needsWorkspaceRole ? (
                <RoleField
                  id={workspaceRoleId}
                  label={t("people:add.workspaceRoleLabel")}
                  hint={t("people:add.workspaceRoleHint")}
                  roles={workspaceRoleNames}
                  isLoading={workspaceRolesLoading}
                  isError={workspaceRolesFailed}
                  choice={workspaceChoice}
                  texts={workspaceRoleTexts}
                />
              ) : null}
              {selection && needsProjectRole ? (
                <RoleField
                  id={projectRoleId}
                  label={t("people:add.projectRoleLabel")}
                  hint={t("people:add.projectRoleHint")}
                  roles={projectRoleNames}
                  isLoading={projectRolesLoading}
                  isError={projectRolesFailed}
                  choice={projectChoice}
                  texts={projectRoleTexts}
                />
              ) : null}
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
                aria-busy={isSubmitting}
                className="gap-1"
              >
                {isInvite ? (
                  <MailPlusIcon className="size-3" />
                ) : (
                  <UserPlusIcon className="size-3" />
                )}
                {submitLabel}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogPopup>
    </Dialog>
  );
}

function SuggestionOption({
  id,
  active,
  onHover,
  person,
  onPick,
}: {
  id: string;
  active: boolean;
  onHover: () => void;
  person: Person;
  onPick: () => void;
}) {
  return (
    <div
      id={id}
      role="option"
      tabIndex={-1}
      aria-selected={active}
      onMouseMove={onHover}
      onClick={onPick}
      onKeyDown={() => undefined}
      className={cn(
        "flex w-full cursor-pointer rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
        active && "bg-accent",
      )}
    >
      <PersonCell
        name={person.name}
        email={person.email}
        image={person.image}
        compact
      />
    </div>
  );
}

export default AddPeopleDialog;
