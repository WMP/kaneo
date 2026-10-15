# Upstream changes not merged

Upstream changes that this fork deliberately does not take. Each entry names the upstream change, the reason, what the fork does instead, and when to review it. Read this before resolving an upstream sync (`.claude/skills/upstream-sync/SKILL.md`).

## Project access: "restrict members to selected projects"

- **Upstream:** `b41c2904 feat: restrict members to selected projects` and follow-ups (v2.34+). Migration `0060_flaky_ezekiel` (`workspace_member_access`, `workspace_member_project`, `invitation.project_access`, `invitation.project_ids`). Module `apps/api/src/project-access/*`, route `PUT /workspace/{id}/members/{userId}/project-access`, `GET /workspace/{id}/project-access[/me]`. Web: `components/team/project-access/**`, `project-access-fields.tsx`, `member-project-access-dialog.tsx`, admin "member access" button, invitation fields `projectAccess`/`projectIds`.
- **Reason:** the fork already restricts project access with project memberships and per-project roles (`ganttpro_project_member`, `docs/plans/project-membership.md`). Two access models side by side would make every authorization decision ambiguous.
- **Instead:** `apps/api/src/utils/project-access.ts`, `project-scope-filters.ts`, the project member API and the fork's "Add people" dialog. `0060_flaky_ezekiel` is listed in `scripts/upstream-sync/excluded-migrations.json`; a database created by upstream keeps the tables, which nothing reads, and its members reach no project until they are added (the fork's upgrade rule).
- **Adapters:** `apps/api/src/project-access/` keeps upstream's read-side module paths as thin adapters over the fork's functions (`assertProjectAccess`, `canAccessProject`, `findInaccessibleProjectIds`, `findAccessibleProjects`, `listAccessibleProjectIds`, `filterUsersWithProjectAccess`, `isProjectAccessRestricted`, `isOwnerRole`, `DbOrTx`), so upstream code that imports them compiles. Map the others by hand:

  | Upstream | Fork |
  | --- | --- |
  | `projectAccessCondition(userId, projectRef)` (SQL) | `userProjectScopeSql(userId, await resolveUserProjectScope(userId[, workspaceId]), projectRef, workspaceRef)`, or `accessibleProjectIds` + `projectScopeCondition` |
  | `clearMemberProjectAccess` | `removeUserProjectMemberships(userId, workspaceId[, tx])` |
  | `grantProjectToRestrictedMember` | the creator membership in `project/controllers/insert-project.ts` |
  | `apply/resolve-invitation-project-access`, `hide-inaccessible-invitation-projects`, `keep-hidden-grants` | the fork's project invitations (`ganttpro_invitation_project`) |
  | `replaceMemberProjectAccess`, `publishMemberProjects`, `lockAccessChange`, `unassignInaccessibleTasks` | none; the fork manages access through its project member API |

- **Review:** when upstream changes its access model substantially, or if the fork decides to adopt it.

## Composite-role check of `require-workspace-permission`

- **Upstream:** `rolesAllow` in `apps/api/src/utils/require-workspace-permission.ts` grants a composite role such as `a,b` when any part satisfies the request.
- **Reason:** the fork treats an unknown composite name as granting nothing; adopting `rolesAllow` would widen access.
- **Instead:** the fork's decision logic; upstream's structured 403 body (`MISSING_PERMISSION`, `missingPermissions`, `API_KEY_SCOPE`) is taken.
- **Review:** with any change to role resolution.

## Custom field value rewriting

- **Upstream:** `feat(api): edit custom fields and search repos` rewrites stored values when an option is removed or the type changes (`resolve-field-update.ts`, `plan-choice-value-changes.ts`, `PUT /custom-field/{id}`).
- **Reason:** the fork's contract rejects removing an option that tasks still use (409 `CUSTOM_FIELD_OPTION_IN_USE`) and keeps the type immutable; workspace fields and option colours depend on it.
- **Instead:** `PATCH /custom-field/{id}` with `planCustomFieldUpdate`. Taken from upstream: filling empty values of a project field that becomes required.
- **Review:** if users ask for option removal with value migration.

## Repository layout

- `.claude/skills` stays a directory (fork skills `update-readme`, `verify`, `upstream-sync`, plus links to `.agents/skills/*`), not upstream's single link to `../.agents/skills`.
- `.github/workflows/pr-size-labeler.yml`, `pr-title.yml` stay deleted.
- `README.md` describes Kaneo Pro; upstream's header, sponsors and footer are not taken.
