# Upstream sync decisions

One entry per hard merge decision. Apply an entry again in a later sync without asking; change it only on a deliberate product decision. Skipped upstream changes are in [exceptions.md](exceptions.md); the procedure is in `.claude/skills/upstream-sync/SKILL.md`.

## 2026-10-15: upstream `main` at `4c89504d` (v2.46.x), merge base `1d61ceb6`

About 440 upstream commits. 229 conflicting files.

### Tooling

- Upstream moved from Biome and Turbo to Vite+ (`vp`). Adopted: `biome.json` and `turbo.json` are deleted. `scripts/ci/turbo-env.test.mjs` is deleted because `vp run` does not filter environment variables. CI runs `pnpm lint` (`vp check`).
- `better-auth`, `@better-auth/core` and `@better-auth/*` plugins are pinned to one version (1.6.26). The fork depends on `@better-auth/core` directly, and it must be the same instance as `better-auth`'s.
- Lockfile: take upstream's, then run `pnpm install`.

### Database

- Upstream `0054`–`0059` and `0061`–`0063` are appended to the journal with upstream's tags and `when` values. Their snapshot files collide with the fork's four-digit snapshots and are not kept. `0060_flaky_ezekiel` is excluded ([exceptions.md](exceptions.md)).
- Upstream `0057_common_deadpool` reads `project.background_object_key`, which the fork names `ganttpro_background_object_key`. The copy in this journal is adapted, with a header comment. The trigger function reads both columns through `to_jsonb(OLD)`. `20261015040923_ganttpro_adopt_upstream_schema` repeats the function and index idempotently for databases created by upstream. It also sets upstream's UTC default on `ganttpro_calendar_feed.created_at`, and its snapshot describes the merged `schema.ts`.
- Fork-only tables keep `defaultNow()`. Upstream's `utcNow` default applies to upstream tables only. Changing fork tables is a separate decision.
- Checked on three databases: a fresh one, a fork database at `20261005135555_ganttpro_task_estimate`, and an upstream database at `0063`. Test: `tests/api-integration/upstream-schema-migration.test.ts`. `tests/api-integration/migration-runner.test.ts` now knows that upstream `0054` and `0055` are journal entries.

### API

- Project access: the fork's model only ([exceptions.md](exceptions.md)). Callers that upstream wrote against its model are rewired. The adapters in `apps/api/src/project-access/` cover future callers.
- `workspace-access-middleware.ts` and `require-workspace-permission.ts`: the fork's decisions. Taken from upstream: 404 messages for missing resources, the structured 403 body, `requireApiKeyScope` and the capabilities route.
- Error bodies: upstream's error handler answers every `HTTPException` with JSON `{ message, code }`. Fork tests that compared plain text now read `message`.
- A caller who is not a member of the workspace gets 404 (upstream's `notFoundMessage`), so the answer does not reveal that the workspace or resource exists. A workspace member without access to the project still gets 403. Relation and Jira proposal routes use one 404 message for "unknown" and "not yours".
- Coded errors keep their extra fields next to `message` and `code` (`apps/api/src/errors/http-exception-response.ts`); the Jira contract depends on them.
- An instance administrator is any user whose role list contains `admin` (`hasInstanceAdminRole`), also in the fork's project access code.
- WebSocket delivery closes a socket as soon as its user lost access to the project (upstream), instead of after the 60-second revalidation window.
- Duplicate `workspace_role` rows: the fork's first-row rule stays; upstream's "any row grants" test is not taken (it would widen access).
- Security review of the merge: the recent workspace activity feed (`/activity/workspace/{id}`) drops relation rows that name a hidden task; project key conflicts no longer name the other project; the fork's workspace activity feed and export hide the project names of a move that the caller cannot open; `/task/by-ticket-id` checks the API key scope. Open follow-ups: search over activity still matches the `eventData` of a move; `GET /task/assigned` and `/activity/workspace/{id}` check `task:read` in the workspace role only; duplicating a subtask does not check `task:update` in the parent's project.
- Tasks: upstream's locked-mutation helpers (`withLockedTask`, `publishTaskMutation`) are the base. The fork's multiple assignees, estimates, approval gates, schedule changes and actor source are layered on top.
- `GET /task/by-ticket-id/{ticketId}`: the project scope comes from `resolveUserProjectScope`, and the matched task also needs `project:read` and `task:read` in the role of its project. The answer is 404 otherwise.
- Custom fields: the fork's `PATCH` contract ([exceptions.md](exceptions.md)).
- Columns: workspace-column enforcement is kept. Upstream's `project.updated` events are taken.
- MCP: upstream moved the tool catalog to `packages/mcp/src/tools/register.ts`. The fork's estimate fields and strict schemas were ported there.
- Admin (instance admin workspace management, upstream): kept. Member removal also removes project memberships, closes project sockets and unlinks resources.
- Imports (upstream): an importing user without full access gets a project-admin membership, as with project creation. Imported projects keep upstream's default columns. Workspace-column enforcement is not applied to imports yet.

### Web

Upstream redesigned task details, task cards, the date picker, settings, project views and the bulk bar. The redesign is adopted, and each fork feature was ported into it:

| Fork feature | New location |
| --- | --- |
| Multiple assignees, resources, invite from picker | `components/task/task-assignee-popover.tsx` (the fork's multi-select popover; upstream's `OptionMenu` is single-select), `task-assignee-trigger-content.tsx` |
| Progress, estimate, milestone, baseline, constraint, approval | `components/task/properties/schedule-properties.tsx` (rail and mobile chips) |
| Jira: send task, status proposals | `components/task/header/task-header-actions.tsx`, `JiraTaskPanel` in `properties-rail.tsx` and `property-chips.tsx` |
| Blocked by, dependency type and lag | `components/task/task-relations.tsx` |
| Project permission gating in task details | `components/task/properties/use-task-properties.ts` and each popover via `useProjectPermission` |
| Localized calendar | `components/common/date-picker/month-grid.tsx` |
| Diacritics-insensitive picker search | `components/common/option-menu/option-menu.tsx` (`matchesSearch`) |
| Workspace columns enforcement | `components/project/columns/column-list.tsx`, `enforced-columns-alert.tsx` |
| Custom field editing, option colours, inherited workspace fields | `components/project/custom-fields/**` |
| Settings navigation entries of the fork | `components/settings/nav/build-settings-nav.ts` |
| Working calendar, activity retention | `components/settings/workspace-general/*-section.tsx` |
| Add people dialog | `components/nav-secondary.tsx` and the members page |
| Workspace capabilities `addMembers`, `cancelInvitations`, `linkResources` | `packages/permissions/src/capabilities.ts` |

Fork-only settings pages (workspace custom fields, workflow, resources, Jira, MCP, project members) keep their content inside the new page shell.

### i18n

- `scripts/upstream-sync/merge-i18n.mjs` implements the rule. The en-US merge is 3-way. Every locale gets exactly the merged en-US key set plus its own plural forms. A translation is kept only when it translates the current English text.
- New keys from upstream were translated in every locale in the same change.
