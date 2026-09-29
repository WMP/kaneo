# Plan: project-level membership (model B)

Status: accepted by the product owner on 2026-09-29; stage 2a (single-project gate, member API, lifecycle) implemented on `claude/rbac-stage2a-core`, stage 2b (list and cross-project filters, WebSocket revalidation) on `claude/rbac-stage2b-lists`, stages 2c and 2d pending. This plan describes the target. The [invariant index](../agent-guide/invariants.md) records what the code and tests enforce today.

## Goal

A workspace admin creates projects and invites people to a specific project with a chosen role, by link or email. An invited person signs in (for example through OIDC) and sees only the projects they belong to. A project member with the right permissions invites others to the same project, never above their own project role.

## Decisions

| Topic | Decision |
| --- | --- |
| Model | B: access to project data always comes from a project membership, except for full-access users (below). |
| Full access | Workspace owner, instance administrator, and any workspace role that grants `workspace:manage_settings` (the built-in `admin` has it). They see every project in the workspace and act with their workspace role. |
| Upgrade of existing installations | The migration creates the tables and **no rows**. Workspace owners, instance administrators and roles that grant `workspace:manage_settings` keep reaching every existing project through the full-access rule, so nothing is copied for them (a copied `admin` row would become a stale admin right after a demotion). **Every other existing member (built-in member and viewer, custom roles) loses access to all projects after the upgrade until an administrator adds them.** If a workspace edited its `admin` role and removed `workspace:manage_settings`, those admins are no longer full-access users, so after the upgrade they lose access to existing projects until they are added (a role row that cannot be parsed falls back to the built-in role and keeps the permission). Release notes and user documentation must say this. |
| Project creator | A creator without full access becomes a project member with the project role `admin`. A full-access creator gets no row: it already reaches every project, and a stored row would become a stale admin right after a demotion. |
| Project role | A name from the workspace role catalog (built-in `viewer`, `member`, `admin`, or a custom `workspace_role`). Its statements apply only inside that project. `owner` is never a project role. |
| Invitation to a project | The inviter chooses the workspace role and the project role. Both must be a subset of the inviter's own permissions: workspace role against the inviter's workspace role, project role against the inviter's effective role in that project. |
| Member list for restricted users | Only full-access members and members who share at least one project with the caller. |

## Access rule

`resolveProjectAccess(userId, projectId)` is the single source of truth:

1. No workspace membership and not an instance administrator: no access.
2. Instance administrator, owner, or workspace role with `workspace:manage_settings`: full access with the workspace role's statements.
3. A `ganttpro_project_member` row: access with the project role's statements.
4. Otherwise: no access.

Workspace membership is always checked first, so a stale project membership never grants access after a user leaves the workspace. Project-scoped permission checks (`requireWorkspacePermission` on a route that resolved a project) use the statements from this rule. Workspace-scoped actions (settings, roles, workspace invitations, creating projects) keep using the workspace role. API-key permission scopes are still intersected.

## Data model

New additive migration after `0055_ganttpro_resources`:

- `ganttpro_project_member(id, project_id → project cascade, user_id → user cascade, role, created_at)`, unique `(project_id, user_id)`, index on `user_id`.
- `ganttpro_invitation_project(id, invitation_id → invitation cascade, project_id → project cascade, role)`, unique `(invitation_id, project_id)`.
- Later stage, not in 0056: `ganttpro_calendar_feed.ganttpro_created_by` (nullable user id) so a feed stops serving when its creator loses project access. Legacy feeds without a creator keep working and are listed as a known gap.
- Both tables carry a `CHECK` that the role is not `owner`, also inside a composite name such as `admin,owner`. There is no backfill.

Removing a workspace member (remove, leave, account deletion) deletes that user's memberships in the workspace's projects. Moving a project to another workspace drops memberships of users who are not members of the target workspace.

## Stage 2a decisions and current state

- Project role that cannot be exercised (`owner`, or a name that no longer resolves in the workspace catalog) grants no access instead of read access without permissions. Moving a project to another workspace drops members who are not in the target workspace and members whose custom role does not exist there.
- Full-access users are listed by `GET /api/project/{id}/members` with `source: "full-access"` and their workspace role. They cannot be changed or removed at project level (400) and cannot be added as project members (409). A project row of such a user (for example from before a promotion) is inert.
- Workspace-level resources (`workspace`, `member`, `invitation`, `organization`, `ac`, `team`) are always evaluated against the workspace role, also inside a project request (a full-access caller's resolved access already holds that role's statements, so no extra lookup); a project role only carries `project`, `task`, `label` and similar. Managing integrations, reading their secrets and importing comments with external authors therefore stay with `workspace:manage_settings` in the workspace role. The project member API checks `member:*` against the project statements on its own.
- A workspace role that a project membership or a pending project invitation (by the workspace of the invited project) still names cannot be deleted; renaming it is refused as well (rename is blocked rather than synchronised). Both are enforced in `hooks.before` for `/organization/delete-role` and `/organization/update-role`, since Better Auth has no role hook. The guard answers only a caller Better Auth would allow (a member of that workspace holding `ac:delete` or `ac:update`, owners included; instance administrators get no special treatment because Better Auth gives them none) and skips only `owner`, since `viewer`, `member` and `admin` are dynamic catalog rows that can be deleted or renamed. It resolves the session with `auth.api.getSession`, which re-runs the API-key plugin's usage claim: a request authenticated with `x-api-key` counts twice against the key's rate limit and `remaining` (a known limitation shared with invitation re-sends); the error carries `code: "ROLE_IS_ASSIGNED_TO_PROJECT_MEMBERS"`.
- A project membership whose role grants nothing is listed with `active: false`; anybody with `member:delete` may remove it and anybody with `member:update` may re-assign it. Role changes and removals only touch the row that was checked and answer 409 if it changed meanwhile.
- Moving a project also drops its pending project invitations.
- Better Auth does not enforce one `workspace_member` row per user and workspace. Duplicates with the same role count once; duplicates that disagree on the role are ambiguous and count as no workspace membership (fail closed, instance administrators excepted) until an administrator fixes them. The member list shows each person once. "Role has an owner part" is one definition in SQL (`apps/api/src/utils/owner-role.ts`, also used by the CHECK constraints) and in `isOwnerRole`, compared in a test.
- Known window: `createProject` reads the creator's full-access status before its transaction; a role change in between yields either no admin row for a demoted creator or an inert row for a promoted one. Accepted.
- Removing a workspace member deletes their project memberships in that workspace in `beforeRemoveMember`; `/organization/leave` runs no organization hook and is handled in `hooks.after`. Account deletion cascades by foreign key.
- Also gated in 2a because they are single-project writes: creating a task label on a task (`POST /api/label` with `taskId`) and attaching a label to a task from the body (`label:update` in that task's project), creating a relation whose target lives in another project (`task:update` there), moving a task into another project (access plus `task:create` there), project move source and bulk task updates (every project).
- Events: no existing event type describes a membership change, so `POST/PATCH/DELETE /api/project/{id}/members` publish none. Realtime refresh and closing sockets of removed members belong to stage 2b.
- MCP and the typed client: no new MCP tools in 2a. MCP tools call the same HTTP routes and inherit the gate, but they cannot yet list or change project members; add tools together with the web UI in 2d if agents need them. The web client needs no change for the gate itself.
- Not yet covered in 2a, done in 2b (below): list, portfolio, search, workload and workspace activity filters, workspace member list for restricted users, relation targets and subtask counts, assignee validation, notifications, WebSocket delivery and close on removal, project reorder. Calendar feeds remain open.

## Stage 2b decisions and current state

Rule: a user without full access receives nothing from a project they are not a member of, not rows, counts, names, or the existence of a task on the far side of a relation. `accessibleProjectIds(userId, workspaceId)` is resolved once per request and turned into SQL by `projectScopeCondition` in `apps/api/src/utils/project-scope-filters.ts` (`null` adds no condition, an empty list matches nothing). Public routes (`isPublic`) are unchanged. MCP tools and API keys call the same HTTP routes and inherit every filter below (`tests/api-integration/project-scope-filters.test.ts`).

- Filtered: `GET /project` with its statistics, `GET /project/portfolio` (a dependency needs both projects), `GET /search` (`projectId` and `excludeProjectId` only narrow), workload and its drill-through (`projectId` only narrows), workspace activity and its export, `GET /label/workspace/{workspaceId}`, `GET /task-relation/{taskId}`, `GET /task-relation/project/{projectId}`, the project task export, board subtask counters, notification list and mark-as-read.
- Workspace-level activity (no task, so tied to no project, for example calendar changes) stays visible to every caller who may read workspace activity. Workspace label definitions without a task stay too.
- `PUT /project/reorder` refuses an inaccessible id exactly like an unknown one (400, same message shape) and returns only the caller's projects. The ranks of projects the caller cannot see are kept.
- A relation to a task in an inaccessible project is dropped entirely, not redacted. Updating or deleting such a relation answers 404.
- Notifications about a task need project access to be listed, created, mentioned or delivered on every channel: `notificationResourceAccess` takes the user's project scope (`resolveUserProjectScope`), and `canReceiveResourceNotification` (used by `createNotification` and `deliverNotification`) calls `resolveProjectAccess`. Due-date reminders skip an assignee without access before writing the sent marker. Notification rules accept only accessible projects, and a stale stored selection is not echoed.
- Assignees: a new assignee must be able to open the task's project (`assertProjectAssignableUser`, `filterProjectAssignableUsers`) on create, update, assignee, assignees, import and duplicate; instance administrators stay assignable. Only NEW assignees are checked, so editing a task whose current assignee lost their membership still works and they can be removed. Every failure has the same message, whether the user does not exist, is in another workspace, or lacks the project. Mentions rely on the notification rule above.
- Workspace member list (`GET /workspace/{id}/members`, MCP `list_workspace_members`, workload rows): a restricted caller sees themselves, full-access members and members sharing at least one project with them; full-access callers see everyone.
- WebSocket: connections keep `validatedAt`; delivery re-runs `resolveProjectAccess` (once per user and delivery) when it is older than `ACCESS_REVALIDATE_MS` (60 s) and closes the socket with 1008 "Project access revoked" (1011 when the check fails). `closeUserProjectConnections` and `closeUserWorkspaceConnections` in `apps/api/src/ws/index.ts` close sockets at once on every instance (an `ACCESS_REVOKED` message over the Redis channel, local otherwise). Relation events deliver to each project only ids of tasks in that project. The user socket carries no project data.

Open after 2b (each is an explicit gap, not a decision):

- Call the WebSocket close helpers where access ends: project member removal and role change (`apps/api/src/project-member/`), workspace member removal and leave (`apps/api/src/auth.ts`). Until then a removed member's socket lives up to 60 s and only closes when an event is delivered.
- `apps/api/src/task/controllers/bulk-update-tasks.ts` still validates `updateAssignee` with the workspace-level `assertAssignableUser`; it must use `assertProjectAssignableUser` per task project.
- The web assignee and mention pickers read Better Auth `organization.listMembers`, which returns the whole workspace; stage 2d switches them to a Kaneo route (or the filtered member list).
- Calendar feeds (`apps/api/src/calendar-feed/`) are public by token and are not tied to their creator, so a feed keeps serving a project's tasks after its creator lost access. Fixing it needs the `ganttpro_created_by` column planned above, so it belongs to a schema stage.
- Workspace resources (people, equipment, material) are workspace-level and are still listed to every workspace member, and workload lists person resources.

## Enforcement surfaces

Gate (single project): every `workspaceAccess.from*` resolver in `apps/api/src/utils/workspace-access-middleware.ts` returns the project id together with the workspace id and applies the access rule. The resolvers outside that middleware are handled one by one: task relations, integrations `scopeToProjectFromBody`, WebSocket upgrade, asset access, project move target, bulk task updates.

Filter (many projects): project list, portfolio, search, workload, workspace activity and its export, workspace labels, relations and the existence of the task on the other side, subtask counts, notifications (`notificationResourceAccess`, `canReceiveResourceNotification`), due-date reminders, workspace member list, assignee validation (`assertAssignableUser` must require access to the task's project), task move target, WebSocket delivery, calendar feeds. MCP tools and API keys use the same HTTP routes and inherit the rules.

Public projects (`isPublic`) remain readable without an account.

## Stages

| Stage | Branch | Scope | Verification |
| --- | --- | --- | --- |
| 2a | `claude/rbac-stage2a-core` | Schema and migration (tables, no backfill); `resolveProjectAccess`; middleware and project-scoped permissions; creator membership; cleanup on member removal; project member API (`GET/POST/PATCH/DELETE /api/project/{id}/members`, assignable project roles) with the delegation rule. | Migration on a fresh and on a populated database; integration tests per single-project route family (allowed member, non-member, full-access user, other workspace); existing suites. |
| 2b | `claude/rbac-stage2b-lists` | All filter surfaces above, WebSocket delivery and close on removal. Calendar feed creator moves to a later schema stage. | Integration test per endpoint: data of an inaccessible project is absent, including relation targets and counts. |
| 2c | `claude/rbac-stage2c-invites` | Project invitations (`POST /api/project/{id}/invitations`), accept hook that creates project memberships, direct add of an existing workspace member, delegation checks. | Integration tests for escalation attempts, acceptance, link and email delivery. |
| 2d | `claude/rbac-stage2d-web` | Project members settings, invite to project, assignee pickers from project members, empty states for users without projects. | Component tests, web typecheck, browser pass of the invite and accept flow. |

Each stage is reviewed per commit, security-reviewed, merged fast-forward into `claude/gantt-pro`, and built by CI before the next dependent stage starts.

## Risks

- Upgrade changes behavior for existing members (decision above). Test the migration against a populated database.
- A missed read path leaks data. The inventory in stage 2b is the checklist; each entry needs a test.
- Performance on large boards: access is resolved once per request; list filters use one `IN (subquery)` on indexed columns.
