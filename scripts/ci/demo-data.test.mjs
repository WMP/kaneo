import assert from "node:assert/strict";
import test from "node:test";
import * as demo from "../demo/data.mjs";
import {
  assertUpstreamRequest,
  BASE_ROUTES,
} from "../demo/upstream-contract.mjs";

const {
  BASE_ACTIVITY_TYPES,
  BASE_FIELDS,
  BASE_RELATION_TYPES,
  BASE_WORKSPACE_ROLES,
  COLLECTIONS,
  DEFAULT_COLUMNS,
  DEPENDENCY_TYPES,
  LAYERS,
  SINGLE_ENTITIES,
  activity,
  calendar,
  calendarFeeds,
  columns,
  customFields,
  defaultAnchor,
  dependencies,
  externalLinks,
  labels,
  parseAnchor,
  projectInvitations,
  projectMembers,
  projects,
  relations,
  resolveDates,
  resolveOffset,
  resolveTimestamp,
  resources,
  taskPro,
  tasks,
  timeEntries,
  users,
  workspaceCustomFields,
  workspaceInvitations,
} = demo;

const DAY_MS = 24 * 60 * 60 * 1000;
const POLISH_LETTERS =
  /[\u0105\u0107\u0119\u0142\u0144\u00f3\u015b\u017a\u017c\u0104\u0106\u0118\u0141\u0143\u00d3\u015a\u0179\u017b]/u;

function keysOf(list) {
  return new Set(list.map((entry) => entry.key));
}

function collectStrings(value, found = []) {
  if (typeof value === "string") found.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, found);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, found);
  }
  return found;
}

// Every string of the module, keys and values (exported functions are skipped).
function allStrings() {
  const strings = [];
  for (const [name, value] of Object.entries(demo)) {
    if (typeof value === "function") continue;
    strings.push(name);
    collectStrings(value, strings);
  }
  return strings;
}

function hasCycle(edges) {
  const next = new Map();
  for (const [from, to] of edges) {
    if (!next.has(from)) next.set(from, []);
    next.get(from).push(to);
  }
  const state = new Map(); // 1 = on the current path, 2 = done
  const visit = (node) => {
    if (state.get(node) === 1) return true;
    if (state.get(node) === 2) return false;
    state.set(node, 1);
    for (const child of next.get(node) ?? []) if (visit(child)) return true;
    state.set(node, 2);
    return false;
  };
  for (const node of next.keys()) if (visit(node)) return true;
  return false;
}

const taskByKey = new Map(tasks.map((task) => [task.key, task]));
const userKeys = keysOf(users);
const projectKeys = keysOf(projects);
const labelKeys = keysOf(labels);
const resourceKeys = keysOf(resources);

test("every entity has a layer", () => {
  const entities = [
    ...Object.values(SINGLE_ENTITIES),
    ...Object.values(COLLECTIONS).flat(),
  ];
  assert.ok(entities.length > 100);
  for (const entity of entities) {
    assert.ok(
      LAYERS.includes(entity.layer),
      `entity without a valid layer: ${JSON.stringify(entity).slice(0, 120)}`,
    );
  }
});

test("base entities only use what upstream Kaneo v2.29.3 has", () => {
  // Only the activity script mixes layers; every other base collection is base.
  for (const [name, list] of Object.entries(COLLECTIONS)) {
    const layers = new Set(list.map((entity) => entity.layer));
    if (!(name in BASE_FIELDS)) {
      assert.deepEqual([...layers], ["pro"], `${name} must be Pro only`);
      continue;
    }
    if (name !== "activity") {
      assert.deepEqual([...layers], ["base"], `${name} must be base only`);
    }
    for (const entity of list) {
      if (entity.layer !== "base") continue;
      const extra = Object.keys(entity).filter(
        (field) => !BASE_FIELDS[name].includes(field),
      );
      assert.deepEqual(
        extra,
        [],
        `base ${name} entity uses Pro-only fields: ${JSON.stringify(entity).slice(0, 120)}`,
      );
    }
  }
  for (const user of users) {
    assert.ok(BASE_WORKSPACE_ROLES.includes(user.workspaceRole), user.key);
  }
  for (const invitation of workspaceInvitations) {
    assert.ok(BASE_WORKSPACE_ROLES.includes(invitation.workspaceRole));
    assert.notEqual(invitation.workspaceRole, "owner");
  }
  for (const relation of relations) {
    assert.ok(BASE_RELATION_TYPES.includes(relation.type), relation.type);
  }
  for (const step of activity.filter((entry) => entry.layer === "base")) {
    assert.ok(BASE_ACTIVITY_TYPES.includes(step.type), step.type);
  }
  // Upstream knows one assignee per task and project-level custom fields.
  for (const task of tasks) {
    assert.equal(typeof (task.assignee ?? ""), "string", task.key);
  }
  for (const field of customFields) assert.equal(field.scope, "project");
  for (const field of workspaceCustomFields) {
    assert.equal(field.scope, "workspace");
    assert.equal(field.layer, "pro");
  }
});

test("keys are unique and task titles are unique", () => {
  for (const [name, list] of Object.entries(COLLECTIONS)) {
    const keys = list.map((entity) => entity.key).filter(Boolean);
    assert.equal(new Set(keys).size, keys.length, `duplicate keys in ${name}`);
  }
  const titles = tasks.map((task) => task.title);
  assert.equal(new Set(titles).size, titles.length);
  const fieldKeys = [...customFields, ...workspaceCustomFields].map(
    (field) => field.key,
  );
  assert.equal(new Set(fieldKeys).size, fieldKeys.length);
  const fieldNames = [...customFields, ...workspaceCustomFields].map(
    (field) => field.name,
  );
  assert.equal(new Set(fieldNames).size, fieldNames.length);
});

test("everything refers to something that exists", () => {
  for (const column of columns) assert.ok(projectKeys.has(column.project));
  for (const field of customFields) assert.ok(projectKeys.has(field.project));
  for (const member of projectMembers) {
    assert.ok(projectKeys.has(member.project));
    assert.ok(userKeys.has(member.user));
    assert.notEqual(member.role, "owner");
  }
  for (const invitation of projectInvitations) {
    assert.ok(projectKeys.has(invitation.project));
    assert.notEqual(invitation.workspaceRole, "owner");
    assert.notEqual(invitation.projectRole, "owner");
  }
  for (const feed of calendarFeeds) {
    assert.ok(projectKeys.has(feed.project));
    for (const label of feed.labels) assert.ok(labelKeys.has(label));
  }

  const projectFieldsByProject = new Map(
    projects.map((project) => [
      project.key,
      new Map(
        customFields
          .filter((field) => field.project === project.key)
          .map((field) => [field.key, field]),
      ),
    ]),
  );
  for (const task of tasks) {
    assert.ok(projectKeys.has(task.project), task.key);
    if (task.assignee) assert.ok(userKeys.has(task.assignee), task.key);
    for (const label of task.labels ?? []) assert.ok(labelKeys.has(label));
    for (const [fieldKey, value] of Object.entries(task.fields ?? {})) {
      const field = projectFieldsByProject.get(task.project).get(fieldKey);
      assert.ok(field, `${task.key}: unknown project field ${fieldKey}`);
      if (field.type === "dropdown") {
        assert.ok(field.options.includes(value), `${task.key}: ${value}`);
      }
    }
  }

  for (const relation of relations) {
    assert.ok(taskByKey.has(relation.from), relation.from);
    assert.ok(taskByKey.has(relation.to), relation.to);
    assert.notEqual(relation.from, relation.to);
  }
  const relationIds = relations.map(
    (relation) => `${relation.type}:${relation.from}>${relation.to}`,
  );
  assert.equal(new Set(relationIds).size, relationIds.length);

  const workspaceFields = new Map(
    workspaceCustomFields.map((field) => [field.key, field]),
  );
  const seenPro = new Set();
  for (const entry of taskPro) {
    assert.ok(taskByKey.has(entry.task), entry.task);
    assert.ok(!seenPro.has(entry.task), `two Pro entries for ${entry.task}`);
    seenPro.add(entry.task);
    for (const user of entry.assignees ?? []) assert.ok(userKeys.has(user));
    for (const resource of entry.resources ?? []) {
      assert.ok(resourceKeys.has(resource), resource);
    }
    for (const [fieldKey, value] of Object.entries(entry.fields ?? {})) {
      const field = workspaceFields.get(fieldKey);
      assert.ok(field, `${entry.task}: unknown workspace field ${fieldKey}`);
      if (field.type === "dropdown") {
        assert.ok(field.options.includes(value), `${entry.task}: ${value}`);
      }
    }
    if (entry.assignees) {
      // The first Pro assignee is the base assignee.
      assert.equal(entry.assignees[0], taskByKey.get(entry.task).assignee);
    }
    if (entry.constraint) {
      assert.ok(
        [
          "start_no_earlier_than",
          "finish_no_later_than",
          "must_start_on",
        ].includes(entry.constraint.type),
      );
    }
    if (entry.approval) {
      assert.ok(
        ["pending", "approved", "rejected"].includes(entry.approval.status),
      );
    }
  }
  for (const link of externalLinks) assert.ok(taskByKey.has(link.task));
  for (const entry of timeEntries) {
    assert.ok(taskByKey.has(entry.task));
    assert.ok(userKeys.has(entry.by));
  }

  // Every dependency type belongs to an existing blocks relation.
  const blocks = new Set(
    relations
      .filter((relation) => relation.type === "blocks")
      .map((relation) => `${relation.from}>${relation.to}`),
  );
  for (const dependency of dependencies) {
    assert.ok(
      blocks.has(`${dependency.from}>${dependency.to}`),
      `no blocks relation ${dependency.from} > ${dependency.to}`,
    );
    assert.ok(Number.isInteger(dependency.lag), "lag is a whole number");
  }

  for (const step of activity) {
    assert.ok(userKeys.has(step.by), step.by);
    assert.ok(taskByKey.has(step.task), step.task);
  }
  // Base actors act without a project membership: owner or admin only.
  const fullAccess = new Set(
    users
      .filter((user) => ["owner", "admin"].includes(user.workspaceRole))
      .map((user) => user.key),
  );
  for (const step of activity.filter((entry) => entry.layer === "base")) {
    assert.ok(
      fullAccess.has(step.by),
      `base actor ${step.by} needs a membership`,
    );
  }
  for (const entry of timeEntries) assert.ok(fullAccess.has(entry.by));
  // A user can only act in a project after the Pro layer added the membership.
  const members = new Set(
    projectMembers.map((member) => `${member.project}:${member.user}`),
  );
  for (const step of activity.filter((entry) => entry.layer === "pro")) {
    const project = taskByKey.get(step.task).project;
    assert.ok(
      fullAccess.has(step.by) || members.has(`${project}:${step.by}`),
      `${step.by} cannot act in ${project}`,
    );
  }
});

test("blocks and subtask relations have no cycle", () => {
  const edges = (types) =>
    relations
      .filter((relation) => types.includes(relation.type))
      .map((relation) => [relation.from, relation.to]);
  assert.equal(hasCycle(edges(["blocks"])), false, "blocks cycle");
  assert.equal(hasCycle(edges(["subtask"])), false, "subtask cycle");
  assert.equal(hasCycle(edges(["blocks", "subtask"])), false, "combined cycle");
  // A summary task has several children and every child has one parent.
  const children = relations.filter((relation) => relation.type === "subtask");
  const parents = children.map((relation) => relation.to);
  assert.equal(new Set(parents).size, parents.length);
  assert.ok(children.length >= 2);
});

test("the demo shows cross-project dependencies", () => {
  const crossProject = relations.filter(
    (relation) =>
      relation.type === "blocks" &&
      taskByKey.get(relation.from).project !==
        taskByKey.get(relation.to).project,
  );
  assert.ok(crossProject.length >= 3);
});

test("every e-mail address ends in @example.com", () => {
  const emails = allStrings().filter((value) => value.includes("@"));
  assert.ok(emails.length >= 6);
  for (const email of emails) {
    assert.match(email, /^[a-z0-9.]+@example\.com$/, email);
  }
  assert.equal(new Set(users.map((user) => user.email)).size, users.length);
});

test("no string contains a Polish letter", () => {
  for (const value of allStrings()) {
    assert.doesNotMatch(value, POLISH_LETTERS, value);
  }
  // The letters are matched in both cases.
  assert.match(
    "Za\u017c\u00f3\u0142\u0107 g\u0119\u015bl\u0105 ja\u017a\u0144",
    POLISH_LETTERS,
  );
  assert.match("\u0141\u00d3D\u0179", POLISH_LETTERS);
});

test("the default anchor is a Monday", () => {
  const isMonday = (day) => new Date(`${day}T00:00:00Z`).getUTCDay() === 1;
  assert.ok(isMonday(defaultAnchor()));
  const start = Date.UTC(2026, 8, 28, 0, 0, 0); // a Monday, 00:00 UTC
  for (let step = 0; step < 14 * 24; step++) {
    const now = new Date(start + step * 60 * 60 * 1000);
    const anchor = defaultAnchor(now);
    assert.ok(isMonday(anchor), `${now.toISOString()} -> ${anchor}`);
    assert.ok(
      Date.parse(`${anchor}T00:00:00Z`) <= now.getTime() &&
        now.getTime() - Date.parse(`${anchor}T00:00:00Z`) < 7 * DAY_MS,
    );
  }
  // Sunday evening still belongs to the week that started six days before.
  assert.equal(defaultAnchor(new Date("2026-10-04T23:59:59Z")), "2026-09-28");
  assert.equal(defaultAnchor(new Date("2026-10-05T00:00:00Z")), "2026-10-05");
  assert.doesNotThrow(() => parseAnchor("2026-09-28"));
  assert.throws(() => parseAnchor("2026-09-29"), /Monday/);
  assert.throws(() => parseAnchor("2026-02-30"), /calendar date/);
  assert.throws(() => parseAnchor("tomorrow"), /YYYY-MM-DD/);
});

test("offsets resolve to ISO dates", () => {
  assert.equal(resolveOffset("2026-09-28", 0), "2026-09-28");
  assert.equal(resolveOffset("2026-09-28", 3), "2026-10-01");
  assert.equal(resolveOffset("2026-09-28", -1), "2026-09-27");
  assert.equal(
    resolveTimestamp("2026-09-28", { day: -4, time: "09:00" }),
    "2026-09-24T09:00:00.000Z",
  );
  const resolved = resolveDates("2026-09-28");
  assert.equal(resolved.tasks.requirements.start, "2026-10-01");
  assert.equal(resolved.tasks.goLive.planStart, "2026-12-21");
  assert.equal(resolved.tasks.goLive.start, "2026-12-23");
  assert.equal(resolved.tasks.freezeReview.constraintDate, "2026-11-04");
  assert.equal(resolved.tasks.mechanical.constraintDate, null);
  assert.ok(resolved.holidays.some((holiday) => holiday.date === "2026-10-15"));
});

test("dates are consistent for any anchor", () => {
  const anchors = ["2026-09-28", "2027-03-01", "2028-02-28", "2024-12-30"];
  const holidayNames = calendar.holidays.map((holiday) => holiday.name);
  for (const name of holidayNames) {
    assert.doesNotMatch(
      name,
      /independence|national|christmas|easter|thanksgiving|new year|epiphany/i,
      `${name} is tied to a country or a religion`,
    );
  }
  for (const anchor of anchors) {
    const dates = resolveDates(anchor);
    const holidays = new Set(dates.holidays.map((holiday) => holiday.date));
    assert.equal(holidays.size, calendar.holidays.length, "duplicate holiday");
    const weekday = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();
    for (const holiday of dates.holidays) {
      assert.ok(weekday(holiday.date) >= 1 && weekday(holiday.date) <= 5);
    }
    for (const task of tasks) {
      const resolved = dates.tasks[task.key];
      const pro = taskPro.find((entry) => entry.task === task.key);
      assert.ok(resolved.start <= resolved.due, `${task.key}: start after due`);
      assert.ok(resolved.planStart <= resolved.planDue, `${task.key}: plan`);
      assert.ok(task.start <= task.due, `${task.key}: start after due`);
      for (const day of [
        resolved.start,
        resolved.due,
        resolved.planStart,
        resolved.planDue,
      ]) {
        assert.ok(
          weekday(day) >= 1 && weekday(day) <= 5,
          `${task.key}: ${day}`,
        );
        assert.ok(!holidays.has(day), `${task.key} starts or ends on ${day}`);
      }
      if (pro?.milestone) {
        assert.equal(task.start, task.due, `${task.key}: milestone`);
        assert.equal(resolved.start, resolved.due);
        assert.equal(resolved.planStart, resolved.planDue);
      }
    }
  }
  // Milestones (and only milestones) have a single day.
  for (const entry of taskPro.filter((pro) => pro.milestone)) {
    const task = taskByKey.get(entry.task);
    assert.equal(task.start, task.due, `${entry.task}: start = due`);
    if (entry.plan) assert.equal(entry.plan.start, entry.plan.due);
  }
  for (const task of tasks) {
    const pro = taskPro.find((entry) => entry.task === task.key);
    if (task.start === task.due) {
      assert.ok(pro?.milestone, `${task.key} has one day but is no milestone`);
    }
  }
});

test("every dependency type is FS, SS, FF or SF", () => {
  assert.deepEqual(DEPENDENCY_TYPES, ["fs", "ss", "ff", "sf"]);
  for (const dependency of dependencies) {
    assert.ok(DEPENDENCY_TYPES.includes(dependency.type), dependency.type);
  }
  const used = new Set(dependencies.map((dependency) => dependency.type));
  assert.ok(used.has("ss") && used.has("ff") && used.has("fs"));
});

test("dependencies fit the dates (calendar days are a lower bound)", () => {
  const dependencyOf = new Map(
    dependencies.map((entry) => [`${entry.from}>${entry.to}`, entry]),
  );
  for (const relation of relations.filter((entry) => entry.type === "blocks")) {
    const dependency = dependencyOf.get(`${relation.from}>${relation.to}`);
    const type = dependency?.type ?? "fs";
    const lag = dependency?.lag ?? 0;
    const from = taskByKey.get(relation.from);
    const to = taskByKey.get(relation.to);
    const required = {
      fs: [to.start, from.due],
      ss: [to.start, from.start],
      ff: [to.due, from.due],
      sf: [to.due, from.start],
    }[type];
    const [successor, predecessor] = required;
    assert.ok(
      successor >= predecessor + lag,
      `${relation.from} -> ${relation.to} (${type} ${lag}d) is violated`,
    );
  }
});

test("slips and plans match", () => {
  const slips = activity.filter((step) => step.type === "slip");
  for (const step of slips) assert.equal(step.layer, "pro");
  const slipped = slips.map((step) => step.task);
  assert.equal(new Set(slipped).size, slipped.length, "a task slips twice");
  for (const task of slipped) {
    assert.ok(
      taskPro.find((entry) => entry.task === task)?.plan,
      `${task} slips without a plan`,
    );
  }
  for (const entry of taskPro) {
    const task = taskByKey.get(entry.task);
    const moved =
      entry.plan !== undefined &&
      (entry.plan.start !== task.start || entry.plan.due !== task.due);
    assert.equal(
      slipped.includes(entry.task),
      moved,
      `${entry.task}: a plan that differs from the dates needs exactly one slip`,
    );
    if (entry.plan) {
      assert.ok(entry.plan.start <= entry.plan.due, entry.task);
    }
  }
});

test("statuses, priorities and columns are valid", () => {
  const defaultSlugs = DEFAULT_COLUMNS.map((column) => column.slug);
  const slug = (name) =>
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const slugsOf = (project) => [
    ...defaultSlugs,
    ...columns
      .filter((column) => column.project === project)
      .map((column) => slug(column.name)),
  ];
  const priorities = ["no-priority", "low", "medium", "high", "urgent"];
  for (const task of tasks) {
    assert.ok(slugsOf(task.project).includes(task.status), task.key);
    assert.ok(priorities.includes(task.priority), task.key);
  }
  for (const step of activity) {
    if (step.type === "status") {
      assert.ok(
        slugsOf(taskByKey.get(step.task).project).includes(step.status),
        step.task,
      );
    }
    if (step.type === "priority") assert.ok(priorities.includes(step.priority));
  }
  assert.deepEqual(calendar.workingDays, [1, 2, 3, 4, 5]);
  assert.ok(calendar.workingDays.every((day) => day >= 1 && day <= 7));
});

test("the dataset covers what the README screenshots show", () => {
  // One entry per feature a screenshot needs; it fails when the data loses it.
  assert.ok(
    taskPro.some((entry) => entry.milestone),
    "milestones",
  );
  assert.ok(
    taskPro.some((entry) => entry.baseline),
    "baselines",
  );
  assert.ok(
    taskPro.some((entry) => entry.approval),
    "an approval gate",
  );
  assert.ok(
    taskPro.some((entry) => entry.constraint),
    "date constraints",
  );
  assert.ok(
    taskPro.some((entry) => (entry.assignees ?? []).length > 1),
    "several assignees",
  );
  assert.ok(
    taskPro.some((entry) => entry.resources),
    "resources",
  );
  assert.ok(
    relations.some((relation) => relation.type === "subtask"),
    "a summary task",
  );
  assert.ok(workspaceCustomFields.some((field) => field.optionColors));
  assert.ok(calendar.holidays.length >= 3);
  assert.ok(projectInvitations.length >= 1);
  assert.ok(projects.length === 3);
  assert.ok(
    tasks.filter((task) => task.project === "warehouseRobot").length >= 12,
  );
  assert.ok(tasks.filter((task) => task.project === "firmware").length >= 5);
  assert.ok(tasks.filter((task) => task.project === "pilot").length >= 4);
});

// The guard is what keeps the base layer upstream-compatible: a base seed step
// that reaches for a Pro route or field must fail.
test("the upstream contract accepts base requests and refuses Pro ones", () => {
  assertUpstreamRequest("POST", "/api/task/project1", {
    body: {
      title: "Task",
      description: "Text",
      startDate: "2026-09-28T00:00:00.000Z",
      dueDate: "2026-10-02T00:00:00.000Z",
      priority: "low",
      status: "to-do",
      userId: "user1",
    },
  });
  assertUpstreamRequest("POST", "/api/task-relation", {
    body: { sourceTaskId: "a", targetTaskId: "b", relationType: "blocks" },
  });
  assertUpstreamRequest("PUT", "/api/task/assignee/task1", {
    body: { userId: "user1" },
  });
  assertUpstreamRequest("GET", "/api/notification");

  const refused = [
    // Routes that exist only in Kaneo Pro.
    ["PATCH", "/api/task/bulk", { body: { operation: "updateSchedule" } }],
    [
      "PUT",
      "/api/task/approval/task1",
      { body: { approvalStatus: "approved" } },
    ],
    ["PUT", "/api/task/task1/assignees", { body: { userIds: [] } }],
    ["PATCH", "/api/task-relation/relation1", { body: { lagDays: 2 } }],
    ["POST", "/api/project/project1/members", { body: { userId: "user1" } }],
    ["GET", "/api/calendar/workspace1"],
    ["GET", "/api/resource/workspace/workspace1"],
    // Fields and values that upstream does not know.
    ["POST", "/api/task/project1", { body: { title: "Task", progress: 10 } }],
    [
      "POST",
      "/api/task/project1",
      { body: { title: "Task", isMilestone: true } },
    ],
    [
      "POST",
      "/api/task-relation",
      {
        body: {
          sourceTaskId: "a",
          targetTaskId: "b",
          relationType: "blocks",
          dependencyType: "ss",
        },
      },
    ],
    [
      "POST",
      "/api/task/project1",
      { body: { title: "Task", priority: "critical" } },
    ],
    ["GET", "/api/task/tasks/project1", { query: { includeArchived: "true" } }],
  ];
  for (const [method, path, details] of refused) {
    assert.throws(
      () => assertUpstreamRequest(method, path, details),
      /Base layer/,
      `${method} ${path} should be refused`,
    );
  }
});

test("every route of the upstream contract names its source file", () => {
  const seen = new Set();
  for (const route of BASE_ROUTES) {
    const id = `${route.method} ${route.path}`;
    assert.match(route.source, /\S/, `${id} has no upstream source`);
    assert.ok(!seen.has(id), `${id} is listed twice`);
    seen.add(id);
  }
});
