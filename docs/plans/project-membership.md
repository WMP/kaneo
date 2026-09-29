# Plan: project-level membership (model B)

Status: accepted by the product owner on 2026-09-29; implementation in progress. This plan describes the target. The [invariant index](../agent-guide/invariants.md) records what the code and tests enforce today.

## Goal

A workspace admin creates projects and invites people to a specific project with a chosen role, by link or email. An invited person signs in (for example through OIDC) and sees only the projects they belong to. A project member with the right permissions invites others to the same project, never above their own project role.

## Decisions

| Topic | Decision |
| --- | --- |
| Model | B: access to project data always comes from a project membership, except for full-access users (below). |
| Full access | Workspace owner, instance administrator, and any workspace role that grants `workspace:manage_settings` (the built-in `admin` has it). They see every project in the workspace and act with their workspace role. |
| Upgrade of existing installations | A migration creates project memberships only for workspace members whose role is `owner` or `admin`, with the same role. **Other existing members lose access to all projects after the upgrade until an administrator adds them.** Release notes and user documentation must say this. |
| Project creator | Becomes a project member with the project role `admin`. |
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
- `ganttpro_calendar_feed.ganttpro_created_by` (nullable user id) so a feed stops serving when its creator loses project access. Legacy feeds without a creator keep working and are listed as a known gap.
- Backfill: one project membership per existing project for each workspace member with role `owner` or `admin`.

Removing a workspace member (remove, leave, account deletion) deletes that user's memberships in the workspace's projects. Moving a project to another workspace drops memberships of users who are not members of the target workspace.

## Enforcement surfaces

Gate (single project): every `workspaceAccess.from*` resolver in `apps/api/src/utils/workspace-access-middleware.ts` returns the project id together with the workspace id and applies the access rule. The resolvers outside that middleware are handled one by one: task relations, integrations `scopeToProjectFromBody`, WebSocket upgrade, asset access, project move target, bulk task updates.

Filter (many projects): project list, portfolio, search, workload, workspace activity and its export, workspace labels, relations and the existence of the task on the other side, subtask counts, notifications (`notificationResourceAccess`, `canReceiveResourceNotification`), due-date reminders, workspace member list, assignee validation (`assertAssignableUser` must require access to the task's project), task move target, WebSocket delivery, calendar feeds. MCP tools and API keys use the same HTTP routes and inherit the rules.

Public projects (`isPublic`) remain readable without an account.

## Stages

| Stage | Branch | Scope | Verification |
| --- | --- | --- | --- |
| 2a | `claude/rbac-stage2a-core` | Schema, migration and backfill; `resolveProjectAccess`; middleware and project-scoped permissions; creator membership; cleanup on member removal; project member API (`GET/POST/PATCH/DELETE /api/project/{id}/members`, assignable project roles) with the delegation rule. | Migration on a fresh and on a populated database; integration tests per single-project route family (allowed member, non-member, full-access user, other workspace); existing suites. |
| 2b | `claude/rbac-stage2b-lists` | All filter surfaces above, WebSocket delivery and close on removal, calendar feed creator. | Integration test per endpoint: data of an inaccessible project is absent, including relation targets and counts. |
| 2c | `claude/rbac-stage2c-invites` | Project invitations (`POST /api/project/{id}/invitations`), accept hook that creates project memberships, direct add of an existing workspace member, delegation checks. | Integration tests for escalation attempts, acceptance, link and email delivery. |
| 2d | `claude/rbac-stage2d-web` | Project members settings, invite to project, assignee pickers from project members, empty states for users without projects. | Component tests, web typecheck, browser pass of the invite and accept flow. |

Each stage is reviewed per commit, security-reviewed, merged fast-forward into `claude/gantt-pro`, and built by CI before the next dependent stage starts.

## Risks

- Upgrade changes behavior for existing members (decision above). Test the migration against a populated database.
- A missed read path leaks data. The inventory in stage 2b is the checklist; each entry needs a test.
- Performance on large boards: access is resolved once per request; list filters use one `IN (subquery)` on indexed columns.
