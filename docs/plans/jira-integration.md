# Plan: Jira integration

Status: requested on 2026-09-30, implemented in stages on `claude/jira-integration-etryqs` (branched from `claude/gantt-pro`, to be merged back into it). Stages 1 and 2 (API foundation, then API sync: draft, send, links, status processing, proposals, webhook, poll, notifications, events), stage 3 (web settings: connection, mapping editor at three levels, account token page) and stage 4 (web task UI: send dialog, task sidebar panel with proposals, activity and notification rendering, realtime refresh) are implemented. This plan describes the target. The [invariant index](../agent-guide/invariants.md) records what the code and tests enforce today.

## Goal

A Kaneo task can be sent to Jira as an issue. Every user authenticates to Jira with their own personal access token (PAT). The workspace defines how Kaneo fields map to Jira fields (built-in and custom fields on both sides), how Jira statuses map to Kaneo statuses, and default values. A project can override the workspace mapping, and a user can override it again for their own sends. Before anything is sent, the user reviews and edits the final values in a dialog opened from the task. When somebody changes the status of a linked issue in Jira, Kaneo shows the change and creates a **status proposal**; the Kaneo status does not change until a person with `task:update` in the task's project accepts it.

## Assumptions

- Jira Data Center / Server is the main target: a PAT is sent as `Authorization: Bearer <token>`. Jira Cloud is also supported: the "token" is an API token sent with Basic auth together with the user's Atlassian email. The deployment type is a property of the workspace connection.
- REST API v2 (`/rest/api/2/...`) is used on both, because it accepts plain-text descriptions and exists on Server, Data Center and Cloud.
- One Jira connection per workspace. One Jira issue per Kaneo task, and one Kaneo task per Jira issue.
- Jira webhooks can be configured only by a Jira administrator, so status changes arrive two ways: an optional webhook (authenticated by a secret in the URL, because Jira Server webhooks cannot sign requests) and a poll every 5 minutes that reads the linked issues with the token of the user who linked each issue.
- A Jira instance is often on a private network. Outbound requests follow the existing rules in `apps/api/src/utils/assert-public-destination.ts` and `outbound-request.ts`; a private Jira needs `KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS=true`, like GitLab and Gitea.
- Tokens are encrypted at rest with the existing AES-256-GCM helper (`apps/api/src/notification-preferences/secrets.ts`, key `NOTIFICATION_SECRET_ENCRYPTION_KEY`). Without the key, saving a token answers 503 with the code `JIRA_ENCRYPTION_KEY_MISSING`; Kaneo never stores a plaintext token.

## Decisions

| Topic | Decision |
| --- | --- |
| Connection | Workspace level: base URL, deployment (`server` or `cloud`), active flag, polling flag, webhook secret. Managed with `workspace:manage_settings`. Every workspace member can read the non-secret part (base URL, deployment, active). |
| Token | Per user and connection. Only its owner can set, verify or delete it. It is never returned, logged, published in an event or sent to MCP. The API returns only `connected`, the Jira identity from `/rest/api/2/myself`, `lastVerifiedAt` and `lastError`. |
| Whose token | Every Jira request made for a user uses **that user's** token. The poll uses the token of the user who linked the issue (`createdByUserId`); a link whose creator has no valid token is not polled and shows a hint in the task. |
| Mapping levels | `default` (built-in) < `workspace` < `project` < `user`. The same JSON shape at every level; every key is optional. The user level applies to the user's own sends in that workspace. Status mappings are resolved from `default`, `workspace` and `project` only, because a status proposal belongs to the task, not to a person. |
| Send permission | `task:update` in the task's project (a send writes the task's link) plus a connected token. |
| Proposal permission | Listing: `task:read`. Accepting or rejecting: `task:update` in the task's project. Accepting calls the existing `updateTaskStatus` controller, so the normal `task.status_changed` event, activity, notifications, integrations and WebSocket delivery apply. |
| Information about a Jira change | Every observed status change of a linked issue writes a task activity (`jira_status_changed`) and publishes `jira.status_changed` (WebSocket refresh of the task). A proposal is created only when the mapped Kaneo status differs from the task's status, or when the Jira status is not mapped (then the person who accepts must choose a status). A newer change supersedes an older pending proposal. |
| MCP | No MCP tool in this stage: sending needs a human review of the final values and the user's own PAT, and accepting a proposal is a deliberate human decision. Revisit when a use case exists. |

## Mapping configuration

Stored as JSON text in `ganttpro_jira_mapping.config`, validated with Zod (`apps/api/src/jira-integration/schema.ts`):

```ts
type JiraMappingConfig = {
  jiraProjectKey?: string | null;      // project mapping: Kaneo project -> Jira project
  issueTypeId?: string | null;
  issueTypeName?: string | null;       // display only
  components?: string[] | null;        // default components (replaced as a whole)
  fieldMappings?: JiraFieldMapping[];  // keyed by target.fieldId
  statusMappings?: JiraStatusMapping[];// keyed by jiraStatusId, else lower-cased jiraStatusName
  userMappings?: JiraUserMapping[];    // keyed by kaneoUserId
  labelComponentMappings?: { kaneoLabel: string; jiraComponent: string | null }[]; // keyed by lower-cased kaneoLabel
};

type JiraFieldMapping = {
  target: { fieldId: string; fieldName?: string; type: JiraFieldType };
  source:
    | { kind: "builtin"; field: "title" | "description" | "priority" | "status" | "dueDate" | "startDate" | "labels" | "assignee" | "progress" }
    | { kind: "custom"; customFieldId: string }
    | { kind: "none" };                // only the default value is used
  valueMap?: Record<string, string>;   // Kaneo value -> Jira value (priority, dropdown, status ...)
  defaultValue?: string | number | boolean | string[] | null; // used when the Kaneo value is empty
  disabled?: boolean;                  // true removes an inherited mapping at this level
};

type JiraFieldType =
  | "string" | "text" | "number" | "date" | "datetime"
  | "option" | "options" | "labels" | "components" | "priority" | "user" | "users";

type JiraStatusMapping = { jiraStatusId?: string; jiraStatusName: string; kaneoStatus: string | null }; // null removes
type JiraUserMapping = { kaneoUserId: string; jiraUser: string | null };  // server: username, cloud: accountId; null removes
```

Merge rules (pure function `resolveJiraMapping` in `apps/api/src/jira-integration/mapping.ts`): a scalar key takes the most specific defined value (`null` clears it); `components` is replaced as a whole; list entries are merged by their key, a more specific entry replaces the whole entry, and a removal marker (`disabled: true`, `kaneoStatus: null`, `jiraUser: null`, `jiraComponent: null`) removes it. Every resolved value carries its `origin` (`default`, `workspace`, `project` or `user`) so the UI shows what is inherited.

Built-in defaults: `summary` ← title, `description` ← description, `priority` ← priority (`low`→`Low`, `medium`→`Medium`, `high`→`High`, `urgent`→`Highest`, `no-priority` → empty), `duedate` ← due date, `labels` ← labels (spaces become `-`, Jira labels cannot contain spaces), `assignee` ← primary assignee. No default status mapping.

Assignee resolution: `userMappings` first, then the Jira identity of the Kaneo assignee's own connected token in the same connection, else empty (the user can pick a Jira user in the dialog).

Components: the resolved `components`, plus `labelComponentMappings` applied to the task's labels, without duplicates.

Value conversion to Jira JSON (`apps/api/src/jira-integration/field-values.ts`): `string`/`text` → string, `number` → number, `date` → `YYYY-MM-DD`, `datetime` → ISO 8601, `option` → `{ value }`, `options` → `[{ value }]`, `labels` → string array, `components` → `[{ name }]`, `priority` → `{ name }`, `user` → `{ name }` on Server or `{ accountId }` on Cloud, `users` → array of those. `project` → `{ key }` and `issuetype` → `{ id }` are set from the dialog. Kaneo multiselect values (JSON array in text) become arrays; booleans become the strings `"true"`/`"false"` unless a `valueMap` maps them.

## Data model (migration `0059_ganttpro_jira_integration`, additive)

- `ganttpro_jira_connection(id, workspace_id → workspace cascade UNIQUE, base_url, deployment CHECK in ('server','cloud'), is_active default true, polling_enabled default true, webhook_secret, created_at, updated_at)`.
- `ganttpro_jira_user_token(id, connection_id → connection cascade, user_id → user cascade, encrypted_token, email NULL, jira_account_id NULL, jira_username NULL, jira_display_name NULL, last_verified_at NULL, last_error NULL, created_at, updated_at)`, unique `(connection_id, user_id)`.
- `ganttpro_jira_mapping(id, workspace_id → workspace cascade, scope CHECK in ('workspace','project','user'), project_id → project cascade NULL, user_id → user cascade NULL, config text, updated_by → user set null NULL, created_at, updated_at)`, unique `(workspace_id, scope, project_id, user_id)` with NULLS NOT DISTINCT (or an equivalent `scope_key` column), CHECK that `project_id` is set exactly for `project` and `user_id` exactly for `user`.
- `ganttpro_jira_issue_link(id, task_id → task cascade UNIQUE, connection_id → connection cascade, issue_id, issue_key, issue_url, jira_project_key, last_status_id NULL, last_status_name NULL, last_synced_at NULL, sync_error NULL, created_by_user_id → user set null NULL, created_at, updated_at)`, unique `(connection_id, issue_id)`, index on `issue_key`.
- `ganttpro_jira_status_proposal(id, task_id → task cascade, link_id → link cascade, from_status_name NULL, to_status_id NULL, to_status_name, proposed_status NULL, state CHECK in ('pending','accepted','rejected','superseded') default 'pending', jira_changed_by NULL, jira_changed_at NULL, source CHECK in ('webhook','poll','manual'), resolved_by_user_id → user set null NULL, resolved_status NULL, resolved_at NULL, created_at)`, index `(task_id, state)`, partial unique index: at most one `pending` row per task.

No backfill; an older binary ignores the new tables.

## API (`/api/jira-integration`, module `apps/api/src/jira-integration/`)

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /workspace/{workspaceId}/connection` | workspace member | Connection or null. `webhookSecret` and `webhookUrl` only with `workspace:manage_settings`. |
| `PUT /workspace/{workspaceId}/connection` | `workspace:manage_settings` | Create or update (base URL normalized, https unless private destinations are allowed). A secret is generated on create. |
| `POST /workspace/{workspaceId}/connection/rotate-webhook-secret` | `workspace:manage_settings` | New webhook secret. |
| `DELETE /workspace/{workspaceId}/connection` | `workspace:manage_settings` | Removes connection, tokens, links, proposals (cascade). |
| `GET`/`PUT /workspace/{workspaceId}/mapping` | read: member; write: `workspace:manage_settings` | Workspace level. |
| `GET`/`PUT /project/{projectId}/mapping` | read: `project:read`; write: `project:update` (project statements) | Project level; the GET also returns the resolved parent levels. |
| `GET`/`PUT`/`DELETE /workspace/{workspaceId}/me/token` | the caller only | Token status; PUT verifies against `/rest/api/2/myself` before storing. |
| `GET`/`PUT /workspace/{workspaceId}/me/mapping` | the caller only | User level. |
| `GET /project/{projectId}/resolved-mapping` | `project:read` | Resolved mapping for the caller, with origins. |
| `GET /workspace/{workspaceId}/meta/{projects,issue-types,fields,statuses,components,users}` | member with a connected token | Jira metadata for pickers, read with the caller's token. |
| `GET /task/{taskId}` | `task:read` | Link, pending proposal, last 10 proposals. |
| `GET /task/{taskId}/draft` | `task:update` | Values that would be sent, per field: value, origin (`task` or `default`), required and allowed values when Jira createmeta is readable (a failure is a warning, not an error). |
| `POST /task/{taskId}/send` | `task:update` + token | Body: `jiraProjectKey`, `issueTypeId`, `fields: { fieldId, type, value }[]`. Creates the issue, or updates the linked issue (without project and issue type). Stores the link and writes activity `jira_issue_created` or `jira_issue_updated`. |
| `POST /task/{taskId}/refresh` | `task:read` + token | Reads the issue status now with the caller's token and processes a change. |
| `DELETE /task/{taskId}/link` | `task:update` | Unlink (does not touch the Jira issue). |
| `POST /proposal/{proposalId}/accept` | `task:update` | Body `{ status? }` (required when the proposal has no mapped status). Validated with `assertValidTaskStatus`. |
| `POST /proposal/{proposalId}/reject` | `task:update` | Marks rejected. |
| `POST /webhook/{connectionId}?secret=` | public, secret compared in constant time | Handles `jira:issue_updated` with a `status` changelog item. Unknown issues are ignored with 200. |

Errors are JSON with a `code` where the UI must react: `JIRA_NOT_CONFIGURED`, `JIRA_TOKEN_MISSING`, `JIRA_TOKEN_INVALID`, `JIRA_ENCRYPTION_KEY_MISSING`, `JIRA_REQUEST_FAILED` (with Jira's `errorMessages`/`errors`, never the token), `JIRA_ISSUE_ALREADY_LINKED`, `PROPOSAL_NOT_PENDING`, `STATUS_REQUIRED`.

Events: `jira.issue_linked`, `jira.status_changed`, `jira.status_proposal_created`, `jira.status_proposal_resolved` with `{ taskId, projectId, ... }`, added to `taskUpdateEvents` in `apps/api/src/ws/index.ts` (a `TASK_UPDATED` refresh). A new proposal creates a notification of type `jira_status_proposal` for the task's user assignees and the link creator (`createNotification`, which checks project access).

Stage 2 details beyond the table: unlinking also writes the activity `jira_issue_unlinked` and publishes `jira.issue_unlinked` (also in `taskUpdateEvents`). The first status ever read for a link (a send that could not read it, or a refresh) is a baseline: it is stored without activity or proposal; a webhook is always a change. `GET /task/{taskId}` also returns `sync` (the state of the link creator's token and whether polling is on), and `POST /task/{taskId}/refresh` returns `{ changed, info }`. The draft needs an active connection but not a token (a missing token is a warning); `value` is the editable Kaneo-side value and the mapping's value map is applied again when sending, so a value typed in the dialog that is already a Jira value passes through. A proposal route answers 404 for an unknown proposal, and 403 outside the task's workspace or project.

Scheduler: `jira-status-poll` every 5 minutes under `withJobLease`. Per active connection with polling on, links are grouped by creator, and each group is read in batches of 50 with `POST /rest/api/2/search` (`jql: key in (...)`, `fields: ["status"]`). A 401 marks the creator's token `lastError` and skips the group.

## Web

- Workspace settings, new page "Jira" (`settings/workspace/jira.tsx`): connection form, webhook URL and secret for managers, workspace mapping editor.
- Project settings, integrations page: a Jira section with the project mapping editor, showing inherited values.
- Account settings, new page "Jira" (`settings/account/jira.tsx`): the user's token for the active workspace (verify, identity, delete) and the user mapping editor.
- A shared mapping editor (`apps/web/src/components/jira/mapping-editor.tsx`): field mappings (Kaneo source incl. custom fields → Jira field from metadata or a typed field id, value map, default value, disable inherited), status mappings (Jira status → Kaneo column; hidden at the user level), user mappings (Kaneo member → Jira user), label → component, project key, issue type and default components. Inherited rows show their origin and can be overridden or disabled.
- Task: a "Send to Jira" button in the task page header and the task sheet. It opens a review dialog with every resolved field prefilled (origin badge, required marker, Jira allowed values), editable project, issue type and values; "Send" creates or updates the issue. The task sidebar shows the linked issue (key, link, Jira status, last sync) and a pending proposal with Accept (status picker when unmapped) and Reject; the buttons are shown only with `task:update`, the API enforces it.
- Activity rendering for `jira_status_changed`, `jira_issue_created`, `jira_issue_updated`; notification type `jira_status_proposal`; strings in `i18n/en-US.json` first, Polish translated.

## Stages

1. API foundation: schema, migration, Jira client, mapping resolver (pure unit tests), connection, token, mapping and metadata routes, integration tests for permissions and secret handling.
2. API sync: draft, send, links, status processing, proposals, webhook, poll, notifications, events, integration tests, OpenAPI, docs.
3. Web settings: connection, mapping editor at three levels, account token page.
4. Web task: send dialog, sidebar panel, proposals, activity, notifications, realtime.

## Verification

- Pure tests for `resolveJiraMapping`, field conversion and draft building.
- PostgreSQL integration tests with a mocked Jira client: another workspace's member gets 403 on every route; a viewer cannot send or accept; the token is never in any response, event or activity; a user's token is used only for their own requests; a webhook with a wrong secret is rejected; a Jira status change creates activity and one pending proposal and does not change the task status; accepting changes the status through `updateTaskStatus`; a newer change supersedes the pending proposal.
- `pnpm openapi:check`, `pnpm i18n:check`, API and web typecheck, focused web component tests.

## Open points

- Two-way sync of other fields (title, description) from Jira is out of scope.
- Comments and attachments are not sent.
- The poll reads at most the links whose creator still has a valid token.
