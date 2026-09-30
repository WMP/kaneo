# Plan: workspace columns with optional enforcement

Status: accepted by the product owner on 2026-09-30. Branch `claude/stoic-ritchie-sd7mmc`. This plan describes the target. The [invariant index](../agent-guide/invariants.md) records what the code and tests enforce today.

## Goal

Today board columns exist only per project (`column.project_id`) and are edited on the project workflow settings page. A workspace administrator must be able to define the columns once for the workspace (like workspace labels and workspace custom fields) and, optionally, enforce them: every project of the workspace then has exactly these columns and a project cannot change them.

## Decisions

| Topic | Decision |
| --- | --- |
| Enforcement mode | Strict. With enforcement on, every project has exactly the workspace columns (same name, slug, position, icon, color, final flag). Project column create, update, delete and reorder are refused. A change to a workspace column goes to every project of the workspace. |
| Without enforcement | The workspace columns are only a template. A new project copies them (linked); when the workspace has no columns, a new project keeps `DEFAULT_PROJECT_COLUMNS`. Changes to workspace columns do not touch projects. |
| Turning enforcement on | Match and move. For each project: a project column linked to the workspace column wins, then a project column with the same slug, then a project column whose `toSlug(name)` equals the workspace slug. A workspace column without a match is created in the project. Tasks in a project column without a match move to the fallback column (chosen by the administrator, default: the first workspace column by position), then that project column is deleted. Workflow rules on a deleted column are deleted with it (existing FK cascade); the preview and the result report how many. A matched column takes the workspace slug; tasks in it get the new `status`. |
| Turning enforcement off | Only the flag changes. Links stay, so enabling again is exact. |
| Automation rules | Out of scope. Workflow rules stay per project, because integrations (repositories) belong to a project. |
| Permissions | Reading workspace columns: `project:read` in the workspace role (every member; the project page needs the enforced flag). Managing workspace columns: `project:update` in the workspace role (same as workspace custom fields). Turning enforcement on or off and its preview: `workspace:manage_settings`. |

## Data model (migration `0059_ganttpro_workspace_columns`, additive)

- New table `ganttpro_workspace_column`: `id`, `workspace_id` (FK `workspace.id`, cascade), `name`, `slug`, `position`, `icon`, `color`, `is_final`, `created_at`, `updated_at`; unique `(workspace_id, slug)`; index on `workspace_id`.
- `workspace.ganttpro_enforce_columns boolean not null default false`.
- `column.ganttpro_workspace_column_id text null` (FK `ganttpro_workspace_column.id`, `ON DELETE SET NULL`, `ON UPDATE CASCADE`), indexed.
- No backfill. Every existing workspace has no workspace columns and enforcement off, so existing projects behave as before. An older binary ignores the new table and columns.

## API (`apps/api/src/workspace-column/`, mounted through `apiRouter()`)

| Route | Permission | Behavior |
| --- | --- | --- |
| `GET /api/workspace-column/{workspaceId}` | `project:read` | `{ enforced, columns }` ordered by position. |
| `POST /api/workspace-column/{workspaceId}` | `project:update` | Create `{ name, icon?, color?, isFinal? }`. Slug rules of project columns (`toSlug`, reserved virtual statuses, unique in workspace). Enforced: create the linked column in every project. |
| `PUT /api/workspace-column/{workspaceId}/reorder` | `project:update` | `{ columns: [{ id, position }] }`, every id must belong to the workspace. Enforced: same positions in every project. |
| `PUT /api/workspace-column/{workspaceId}/{columnId}` | `project:update` | Update `name`, `icon`, `color`, `isFinal` (slug stays stable, like project columns). Enforced: same values on every linked project column. |
| `DELETE /api/workspace-column/{workspaceId}/{columnId}` | `project:update` | Optional `moveTasksTo` (workspace column id). Enforced: tasks of linked project columns move to `moveTasksTo`, otherwise 409 when any task exists; the last workspace column cannot be deleted while enforced. |
| `GET /api/workspace-column/{workspaceId}/enforcement-preview?fallbackColumnId=` | `workspace:manage_settings` | Dry run of the match: per project the columns to create, the columns to remove, tasks to move and workflow rules to delete. Only projects the caller can see (full access: all). |
| `PUT /api/workspace-column/{workspaceId}/enforcement` | `workspace:manage_settings` | `{ enforced, fallbackColumnId? }`. On: requires at least one workspace column, runs the sync for every project in one transaction, returns the summary. |

Errors are JSON with a `code`: `WORKSPACE_COLUMNS_ENFORCED` (409, project column mutation while enforced), `WORKSPACE_COLUMNS_EMPTY` (400), `WORKSPACE_COLUMN_NOT_EMPTY` (409), `WORKSPACE_COLUMN_LAST` (409), `WORKSPACE_COLUMN_SLUG_CONFLICT` (409), `WORKSPACE_COLUMN_RESERVED_SLUG` (409). A workspace column id of another workspace answers 404.

Sync core: a pure function `planProjectColumnSync(projectColumns, workspaceColumns, fallbackWorkspaceColumnId)` returns the plan (preview and unit tests use it), and `applyProjectColumnSync(tx, projectId, plan)` writes it. Concurrency: every workspace column mutation and the enforcement toggle lock the workspace row `FOR UPDATE`; project column mutations, project creation and project move read the flag under `FOR SHARE` in the same transaction as their write.

Other surfaces:

- `project/controllers/create-project.ts`: copy workspace columns (linked) when the workspace has any.
- `project/controllers/move-project.ts`: clear `ganttpro_workspace_column_id` of the moved project's columns; if the target workspace is enforced, sync with the first target workspace column as fallback.
- Moving tasks during a sync writes `column_id` and `status` directly and does not publish per-task events, so integrations do not react (for example by closing issues). After the commit the API publishes `project.updated` for every changed project, and `subtask-parents.refresh` when final flags or task columns changed.
- MCP: no new tool. Workspace column management is an administrator setting; `list_project_columns` already reads the effective columns. Project column mutations through any client get the 409 above.
- OpenAPI: regenerate `apps/docs/openapi.json`.

## Web

- New workspace settings page `settings/workspace/workflow.tsx` (sidebar entry next to labels and custom fields): workspace column editor and the enforcement switch. Turning it on opens a dialog with the fallback column and the preview; turning it off asks for confirmation.
- Project workflow page: when enforced, the column editor is read-only and shows a notice with a link to the workspace page (link only for callers who may manage it).
- `PROJECT_UPDATED` on the project socket also invalidates `["columns", projectId]`; workspace column mutations invalidate `["workspace-columns", workspaceId]` and the `["columns"]` prefix.
- i18n: keys in `i18n/en-US.json`, Polish in `i18n/pl-PL.json`, other catalogs through `pnpm i18n:check:fix`.

## Stages and verification

1. API and database: schema, migration, sync, routes, lock of project column routes, project create and move. Integration tests in `tests/api-integration/` (match and move, created and removed columns, rule deletion, 409 on project column routes, propagation of create/update/reorder/delete, new project copies, project move into an enforced workspace, 403 for a member without the permission and for a user of another workspace, nothing persisted after a rejected request) and a migration upgrade test from a populated 0058 database. Unit tests for `planProjectColumnSync`. `pnpm openapi:check`, API typecheck.
2. Web: fetchers, hooks, pages, i18n, realtime invalidation. Component tests and web typecheck; `pnpm i18n:check`.
3. Documentation: database contract (migration 0059), API contract paragraph, invariant `KAN-DATA-002` with its real status.

## Known limitations

- Moved tasks get no activity entry and no integration event.
- The Planka import writes columns directly; it does not apply workspace enforcement.
- Concurrent enforcement toggles and project column writes are serialized by row locks; there is no concurrent test.
