// The part of the Kaneo HTTP API that upstream Kaneo v2.29.3 offers, and that
// the base layer of the demo seed may use. Every entry was checked against the
// upstream source (`git show v2.29.3:<file>`); `source` names the file.
//
// seed.mjs runs every request of a base step through `assertUpstreamRequest`,
// so a base step that reaches for a Pro-only route or request field fails
// immediately instead of passing on a Pro instance and breaking on upstream.

export const UPSTREAM_TAG = "v2.29.3";

const ORG_PLUGIN = "better-auth organization plugin (apps/api/src/auth.ts)";
const EMAIL_AUTH = "better-auth email and password (apps/api/src/auth.ts)";

const PRIORITIES = ["no-priority", "low", "medium", "high", "urgent"];

function route(method, path, source, { body, query, enums } = {}) {
  const pattern = new RegExp(
    `^${path.replace(/:[A-Za-z]+/g, "[^/]+").replaceAll("/", "\\/")}$`,
  );
  return {
    method,
    path,
    source,
    pattern,
    body: body ?? [],
    query: query ?? [],
    enums: enums ?? {},
  };
}

export const BASE_ROUTES = [
  route("GET", "/api/health", "apps/api/src/index.ts"),
  route("GET", "/api/config", "apps/api/src/config/index.ts"),
  route("POST", "/api/auth/sign-up/email", EMAIL_AUTH, {
    body: ["name", "email", "password"],
  }),
  route("POST", "/api/auth/sign-in/email", EMAIL_AUTH, {
    body: ["email", "password"],
  }),
  route("GET", "/api/auth/organization/list", ORG_PLUGIN),
  route("GET", "/api/auth/organization/get-full-organization", ORG_PLUGIN, {
    query: ["organizationId"],
  }),
  route("POST", "/api/auth/organization/create", ORG_PLUGIN, {
    body: ["name", "slug"],
  }),
  route("POST", "/api/auth/organization/delete", ORG_PLUGIN, {
    body: ["organizationId"],
  }),
  route("POST", "/api/auth/organization/invite-member", ORG_PLUGIN, {
    body: ["email", "role", "organizationId"],
    enums: { role: ["admin", "member", "viewer"] },
  }),
  route("POST", "/api/auth/organization/accept-invitation", ORG_PLUGIN, {
    body: ["invitationId"],
  }),
  route(
    "GET",
    "/api/workspace/:workspaceId/members",
    "apps/api/src/workspace/index.ts",
  ),
  route("POST", "/api/project", "apps/api/src/project/schema.ts", {
    body: ["name", "workspaceId", "icon", "slug"],
  }),
  route("GET", "/api/project", "apps/api/src/project/schema.ts", {
    query: ["workspaceId"],
  }),
  route("GET", "/api/column/:projectId", "apps/api/src/column/index.ts"),
  route("POST", "/api/column/:projectId", "apps/api/src/column/schema.ts", {
    body: ["name", "icon", "color", "isFinal"],
  }),
  route("POST", "/api/label", "apps/api/src/label/schema.ts", {
    body: ["name", "color", "workspaceId", "taskId"],
  }),
  route("GET", "/api/label/workspace/:workspaceId", "apps/api/src/label"),
  route("PUT", "/api/label/:id/task", "apps/api/src/label/schema.ts", {
    body: ["taskId"],
  }),
  route("POST", "/api/custom-field", "apps/api/src/custom-field/schema.ts", {
    body: ["projectId", "name", "type", "required", "defaultValue", "options"],
    enums: {
      type: ["text", "number", "date", "dropdown", "boolean", "multiselect"],
    },
  }),
  route(
    "GET",
    "/api/custom-field/project/:projectId",
    "apps/api/src/custom-field/index.ts",
  ),
  route(
    "PUT",
    "/api/custom-field/value",
    "apps/api/src/custom-field/schema.ts",
    { body: ["taskId", "fieldId", "value"] },
  ),
  route("POST", "/api/task/:projectId", "apps/api/src/task/schema.ts", {
    body: [
      "title",
      "description",
      "startDate",
      "dueDate",
      "priority",
      "status",
      "userId",
      "customFields",
    ],
    enums: { priority: PRIORITIES },
  }),
  route("GET", "/api/task/tasks/:projectId", "apps/api/src/task/schema.ts", {
    query: ["limit", "page"],
  }),
  route("GET", "/api/task/:id", "apps/api/src/task/index.ts"),
  route("PUT", "/api/task/status/:id", "apps/api/src/task/schema.ts", {
    body: ["status"],
  }),
  route("PUT", "/api/task/priority/:id", "apps/api/src/task/schema.ts", {
    body: ["priority"],
    enums: { priority: PRIORITIES },
  }),
  route("PUT", "/api/task/assignee/:id", "apps/api/src/task/schema.ts", {
    body: ["userId"],
  }),
  route("POST", "/api/task-relation", "apps/api/src/task-relation/schema.ts", {
    body: ["sourceTaskId", "targetTaskId", "relationType"],
    enums: { relationType: ["subtask", "blocks", "related"] },
  }),
  route("GET", "/api/task-relation/:taskId", "apps/api/src/task-relation"),
  route("POST", "/api/comment/:taskId", "apps/api/src/comment/schema.ts", {
    body: ["content"],
  }),
  route("POST", "/api/time-entry", "apps/api/src/time-entry/schema.ts", {
    body: ["taskId", "startTime", "endTime", "description"],
  }),
  route(
    "POST",
    "/api/external-link/task/:taskId",
    "apps/api/src/external-link/schema.ts",
    { body: ["url", "title"] },
  ),
  route(
    "POST",
    "/api/calendar-feed/project/:projectId",
    "apps/api/src/calendar-feed/schema.ts",
    { body: ["labelIds", "timeZone"] },
  ),
  route("GET", "/api/notification", "apps/api/src/notification/index.ts"),
  route(
    "PATCH",
    "/api/notification/read-all",
    "apps/api/src/notification/index.ts",
  ),
];

// Throws when a base-layer request is not something upstream v2.29.3 accepts.
export function assertUpstreamRequest(method, path, { query, body } = {}) {
  const entry = BASE_ROUTES.find(
    (candidate) => candidate.method === method && candidate.pattern.test(path),
  );
  if (!entry) {
    throw new Error(
      `Base layer: ${method} ${path} is not an upstream Kaneo ${UPSTREAM_TAG} route`,
    );
  }
  for (const field of Object.keys(body ?? {})) {
    if (!entry.body.includes(field)) {
      throw new Error(
        `Base layer: ${method} ${entry.path} has no field "${field}" upstream (${UPSTREAM_TAG})`,
      );
    }
  }
  for (const field of Object.keys(query ?? {})) {
    if (!entry.query.includes(field)) {
      throw new Error(
        `Base layer: ${method} ${entry.path} has no query parameter "${field}" upstream (${UPSTREAM_TAG})`,
      );
    }
  }
  for (const [field, allowed] of Object.entries(entry.enums)) {
    const value = body?.[field];
    if (value !== undefined && !allowed.includes(value)) {
      throw new Error(
        `Base layer: ${method} ${entry.path} field "${field}" = "${value}" is not an upstream value`,
      );
    }
  }
}
