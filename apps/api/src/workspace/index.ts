import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { codedErrorResponse } from "../utils/coded-error";
import { accessibleProjectIds } from "../utils/project-access";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { toCsv } from "../utils/to-csv";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import addWorkspaceMemberCtrl from "./controllers/add-workspace-member";
import exportWorkspaceActivities from "./controllers/export-workspace-activities";
import getAssignableRolesCtrl from "./controllers/get-assignable-roles";
import getWorkspaceActivities from "./controllers/get-workspace-activities";
import getWorkspaceActivityRetention from "./controllers/get-workspace-activity-retention";
import getWorkspaceMembersCtrl from "./controllers/get-workspace-members";
import searchUserDirectoryCtrl, {
  assertUserDirectoryEnabled,
} from "./controllers/search-user-directory";
import updateWorkspaceActivityRetention from "./controllers/update-workspace-activity-retention";
import { assertActorNotGuest } from "./direct-add";
import {
  requireAddRateLimit,
  requireUserDirectoryRateLimit,
} from "./rate-limit";
import {
  addedWorkspaceMemberSchema,
  assignableRolesSchema,
  userDirectoryListSchema,
  workspaceActivityExportSchema,
  workspaceActivityListSchema,
  workspaceActivityRetentionSchema,
  workspaceMemberListSchema,
} from "./response";
import {
  addWorkspaceMemberBody,
  updateWorkspaceActivityRetentionBody,
  userDirectoryQuery,
  workspaceActivityExportQuery,
  workspaceActivityQuery,
  workspaceIdParam,
  workspaceMembersQuery,
} from "./schema";

const EXPORT_CSV_COLUMNS = [
  "id",
  "taskId",
  "taskNumber",
  "taskTitle",
  "projectId",
  "projectName",
  "projectSlug",
  "type",
  "createdAt",
  "userId",
  "userName",
  "content",
  "eventData",
  "externalUserName",
  "externalUserAvatar",
  "externalSource",
  "externalUrl",
] as const;

const getWorkspaceMembersRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceMembers",
  path: "/{workspaceId}/members",
  tags: ["Workspaces"],
  summary: "Get workspace members",
  description:
    "Get the members of a workspace, with their role and join date. A caller with full access (instance administrator, workspace owner, or a role granting workspace:manage_settings) sees every member; any other caller sees only themselves, the full-access members and the members who share at least one project with them, unless their workspace role can create, update or delete members (then they see every member). With include=projects, a caller who manages members (or has full access) also gets, per member, the projects they belong to with their project role (only projects the caller can open) and whether they have full access.",
  middleware: [workspaceAccess.fromParam("workspaceId")] as const,
  request: { params: workspaceIdParam, query: workspaceMembersQuery },
  responses: {
    200: jsonResponse("List of workspace members", workspaceMemberListSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse("No access to the workspace"),
  },
});

const userDirectoryErrorCodes =
  "403 USER_DIRECTORY_DISABLED, 403 GUEST_NOT_ALLOWED, 400 QUERY_TOO_SHORT, 429 RATE_LIMITED";

const searchUserDirectoryRoute = createRoute({
  method: "get",
  operationId: "searchUserDirectory",
  path: "/{workspaceId}/user-directory",
  tags: ["Workspaces"],
  summary: "Search the accounts of the instance",
  description: `Find an existing account of this instance by part of its name or email, to add it to the workspace (POST /members). Requires member:create in the caller's WORKSPACE role (owners and instance administrators included; an API key must allow it too). Returns at most 20 accounts (id, name, email, image) for a query of at least 2 characters; anonymous guest accounts, banned accounts and people who already are members of the workspace are left out. PRIVACY: this reveals that an account exists on the instance, also one that shares no workspace with the caller, so it can be switched off: DISABLE_USER_DIRECTORY=true turns it off, and on Kaneo Cloud it is off unless ENABLE_USER_DIRECTORY=true (see userDirectoryEnabled in GET /config). Searches are rate limited per user. A guest (anonymous) account is refused on every instance. Errors carry a \`code\`: ${userDirectoryErrorCodes}. The shared permission check answers plain text 403.`,
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ member: ["create"] }),
    async (_c, next) => {
      assertUserDirectoryEnabled();
      return next();
    },
    async (c, next) => {
      await assertActorNotGuest(c.get("userId"));
      return next();
    },
    requireUserDirectoryRateLimit,
  ] as const,
  request: { params: workspaceIdParam, query: userDirectoryQuery },
  responses: {
    200: jsonResponse("Matching accounts", userDirectoryListSchema),
    400: codedErrorResponse(
      "Query shorter than 2 characters (QUERY_TOO_SHORT)",
    ),
    403: codedErrorResponse(
      "No access to the workspace, missing member:create permission, a guest caller (GUEST_NOT_ALLOWED), or the directory is disabled (USER_DIRECTORY_DISABLED)",
    ),
    429: codedErrorResponse("Too many searches (RATE_LIMITED)"),
  },
});

const addWorkspaceMemberRoute = createRoute({
  method: "post",
  operationId: "addWorkspaceMember",
  path: "/{workspaceId}/members",
  tags: ["Workspaces"],
  summary: "Add an existing account to the workspace",
  description:
    "Add an existing account of this instance to the workspace with a workspace role, without an invitation. Requires member:create in the caller's WORKSPACE role (an API key must allow it too). The role must exist, must not be owner, and every permission it carries must also be held by the caller (owners and instance administrators may grant any role except owner). The person gets an in-app notification and, where SMTP is configured, an email; a failing email never fails the request (see emailAttempted and emailSent). Project memberships or resource links an earlier membership of the person left in this workspace are dropped first. Adding gives no project access of its own: add the person to projects separately (or use POST /project/{id}/members with workspaceRole). A guest (anonymous) caller is refused on every instance, and every caller may add at most 30 people per 10 minutes (shared with the project route when it adds to the workspace). The workspace member limit (100 by default, also applied when an invitation is accepted) answers 403 WORKSPACE_MEMBER_LIMIT_REACHED. On Kaneo Cloud the gates of invitations apply too (disposable addresses, 5 per minute per user). Adding an account that is not a member yet needs the user directory to be enabled (403 USER_DIRECTORY_DISABLED otherwise: invite the person by email instead). An unknown, anonymous or banned account all answer the same 404 USER_CANNOT_BE_ADDED. Errors carry a `code`: 400 OWNER_ROLE_NOT_ALLOWED, 400 UNKNOWN_ROLE, 404 USER_CANNOT_BE_ADDED, 403 GUEST_NOT_ALLOWED, 403 USER_DIRECTORY_DISABLED, 403 ROLE_EXCEEDS_YOUR_PERMISSIONS, 403 WORKSPACE_MEMBER_LIMIT_REACHED, 409 ALREADY_WORKSPACE_MEMBER, 400 DISPOSABLE_EMAIL_NOT_ALLOWED (cloud), 429 RATE_LIMITED. The shared permission check answers plain text 403.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ member: ["create"] }),
    requireAddRateLimit,
  ] as const,
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: addWorkspaceMemberBody } },
    },
  },
  responses: {
    200: jsonResponse("The new member", addedWorkspaceMemberSchema),
    400: codedErrorResponse("Invalid body, owner role, or unknown role"),
    403: codedErrorResponse(
      "No access to the workspace, missing member:create permission, a guest caller (GUEST_NOT_ALLOWED), the user directory is disabled (USER_DIRECTORY_DISABLED), the role exceeds the caller's permissions, or the member limit (WORKSPACE_MEMBER_LIMIT_REACHED)",
    ),
    404: codedErrorResponse(
      "The account cannot be added: unknown, anonymous or banned (USER_CANNOT_BE_ADDED)",
    ),
    409: codedErrorResponse("The person already is a member of the workspace"),
    429: codedErrorResponse(
      "Too many adds from this user (30 per 10 minutes; on cloud also the invitation limit)",
    ),
  },
});

const getAssignableRolesRoute = createRoute({
  method: "get",
  operationId: "getAssignableRoles",
  path: "/{workspaceId}/assignable-roles",
  tags: ["Workspaces"],
  summary: "Get assignable roles",
  description:
    "List the workspace roles the caller may grant when inviting a member or changing a member's role. A role is assignable only when every permission it carries is also held by the caller; owners and instance administrators can assign every role except owner.",
  middleware: [workspaceAccess.fromParam("workspaceId")] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("Roles the caller may assign", assignableRolesSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse("No access to the workspace"),
  },
});

const getWorkspaceActivityRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceActivity",
  path: "/{workspaceId}/activity",
  tags: ["Workspaces"],
  summary: "Get workspace activity",
  description:
    "List activity across every task in the workspace, newest first: comments alongside system events such as status and assignee changes. Filter by user, activity type, project, or a creation-date range; paginated. A caller without full access (instance administrator, workspace owner, or a role granting workspace:manage_settings) receives only data of projects they are a member of. Activity that belongs to the workspace and to no task stays visible.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: { params: workspaceIdParam, query: workspaceActivityQuery },
  responses: {
    200: jsonResponse(
      "Paginated workspace activity",
      workspaceActivityListSchema,
    ),
    400: errorResponse(
      "Workspace ID could not be determined, or invalid query",
    ),
    403: errorResponse(
      "No access to the workspace, or missing task:read permission",
    ),
  },
});

const getWorkspaceActivityExportRoute = createRoute({
  method: "get",
  operationId: "exportWorkspaceActivity",
  path: "/{workspaceId}/activity/export",
  tags: ["Workspaces"],
  summary: "Export workspace activity",
  description:
    'Export activity across every task in the workspace as CSV or JSON, honoring the same filters (user, activity type, project, date range) and permission as GET /activity. Unpaginated, newest first, capped at 10,000 rows: narrow the filters if the "truncated" flag (or the X-Kaneo-Export-Truncated header on a CSV response) comes back true.',
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: { params: workspaceIdParam, query: workspaceActivityExportQuery },
  responses: {
    200: {
      description: "The workspace activity export, as CSV or JSON",
      content: {
        "text/csv": {
          schema: z.string().openapi({
            description: "Returned when format=csv (the default).",
          }),
        },
        "application/json": {
          schema: workspaceActivityExportSchema.openapi({
            description: "Returned when format=json.",
          }),
        },
      },
    },
    400: errorResponse(
      "Workspace ID could not be determined, or invalid query",
    ),
    403: errorResponse(
      "No access to the workspace, or missing task:read permission",
    ),
  },
});

const getWorkspaceActivityRetentionRoute = createRoute({
  method: "get",
  operationId: "getWorkspaceActivityRetention",
  path: "/{workspaceId}/activity-retention",
  tags: ["Workspaces"],
  summary: "Get the workspace activity retention setting",
  description:
    "Read how many days of activity history this workspace keeps. Null means retention is disabled (keep forever), which is the default. This is a stored setting only; no automatic deletion currently enforces it.",
  middleware: [workspaceAccess.fromParam("workspaceId")] as const,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse(
      "The workspace's activity retention setting",
      workspaceActivityRetentionSchema,
    ),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse("No access to the workspace"),
    404: errorResponse("Workspace not found"),
  },
});

const updateWorkspaceActivityRetentionRoute = createRoute({
  method: "patch",
  operationId: "updateWorkspaceActivityRetention",
  path: "/{workspaceId}/activity-retention",
  tags: ["Workspaces"],
  summary: "Update the workspace activity retention setting",
  description:
    "Set how many days of activity history to keep. 0 or null disables retention (keep forever). This only stores the setting; it does not itself delete anything.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ workspace: ["manage_settings"] }),
  ] as const,
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: {
        "application/json": { schema: updateWorkspaceActivityRetentionBody },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "The updated activity retention setting",
      workspaceActivityRetentionSchema,
    ),
    400: errorResponse("Workspace ID could not be determined, or invalid body"),
    403: errorResponse(
      "No access to the workspace, or missing workspace:manage_settings permission",
    ),
    404: errorResponse("Workspace not found"),
  },
});

const workspace = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(getWorkspaceMembersRoute, async (c) =>
    c.json(
      await getWorkspaceMembersCtrl(
        c.get("workspaceId"),
        c.get("userId"),
        await accessibleProjectIds(c.get("userId"), c.get("workspaceId")),
        { withProjects: c.req.valid("query").include === "projects" },
      ),
      200,
    ),
  )
  .openapi(addWorkspaceMemberRoute, async (c) =>
    c.json(
      await addWorkspaceMemberCtrl({
        workspaceId: c.get("workspaceId"),
        actorUserId: c.get("userId"),
        ...c.req.valid("json"),
      }),
      200,
    ),
  )
  .openapi(searchUserDirectoryRoute, async (c) =>
    c.json(
      await searchUserDirectoryCtrl(
        c.get("workspaceId"),
        c.req.valid("query").q,
      ),
      200,
    ),
  )
  .openapi(getAssignableRolesRoute, async (c) =>
    c.json(
      await getAssignableRolesCtrl(c.get("workspaceId"), c.get("userId")),
      200,
    ),
  )
  .openapi(getWorkspaceActivityRoute, async (c) =>
    c.json(
      await getWorkspaceActivities(
        c.get("workspaceId"),
        c.get("userId"),
        c.req.valid("query"),
      ),
      200,
    ),
  )
  .openapi(getWorkspaceActivityExportRoute, async (c) => {
    const { format, ...filters } = c.req.valid("query");
    const { data, truncated } = await exportWorkspaceActivities(
      c.get("workspaceId"),
      c.get("userId"),
      filters,
    );

    c.header("Cache-Control", "private, no-store");
    c.header("X-Kaneo-Export-Truncated", truncated ? "true" : "false");

    const stamp = new Date().toISOString().slice(0, 10);

    if (format === "json") {
      c.header(
        "Content-Disposition",
        `attachment; filename="workspace-activity-export-${stamp}.json"`,
      );
      return c.json({ data, truncated }, 200);
    }

    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header(
      "Content-Disposition",
      `attachment; filename="workspace-activity-export-${stamp}.csv"`,
    );
    return c.body(toCsv(data, [...EXPORT_CSV_COLUMNS]), 200);
  })
  .openapi(getWorkspaceActivityRetentionRoute, async (c) =>
    c.json(await getWorkspaceActivityRetention(c.get("workspaceId")), 200),
  )
  .openapi(updateWorkspaceActivityRetentionRoute, async (c) =>
    c.json(
      await updateWorkspaceActivityRetention(
        c.get("workspaceId"),
        c.req.valid("json").activityRetentionDays,
      ),
      200,
    ),
  );

export default workspace;
