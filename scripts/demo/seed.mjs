#!/usr/bin/env node
// Seeds the fictional "Northwind Robotics" demo workspace through the HTTP API
// only: Better Auth sign-up and sign-in plus the Kaneo routes. It never touches
// the database, so it works against any instance you can reach.
//
//   node scripts/demo/seed.mjs [--api-url http://localhost:1337] [--reset]
//        [--layers base,pro] [--anchor YYYY-MM-DD] [--out ids.json]
//
// It creates accounts with a known password. Use it only on a local or a
// dedicated demo instance, never on production data. See README.md.
//
// Layers (data.mjs): "base" is what upstream Kaneo v2.29.3 supports and only
// uses routes and fields listed in upstream-contract.mjs; "pro" is everything
// else. `--layers pro` runs on top of an existing base seed.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { ApiClient, ApiError } from "./api.mjs";
import * as demo from "./data.mjs";
import { assertUpstreamRequest } from "./upstream-contract.mjs";

export const DEFAULT_API_URL = "http://localhost:1337";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLocalUrl(url) {
  return LOCAL_HOSTS.has(new URL(url).hostname);
}

function normalizeApiUrl(value) {
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/, "").replace(/\/api$/, "");
  return `${url.origin}${path}`;
}

function normalizeLayers(value) {
  const list =
    value === undefined
      ? demo.LAYERS
      : String(value)
          .split(",")
          .map((layer) => layer.trim())
          .filter(Boolean);
  for (const layer of list) {
    if (!demo.LAYERS.includes(layer)) {
      throw new Error(
        `Unknown layer "${layer}": use base, pro or base,pro (the default)`,
      );
    }
  }
  if (list.length === 0) throw new Error("--layers needs at least one layer");
  return demo.LAYERS.filter((layer) => list.includes(layer));
}

// Validates the options and applies the safety rules. Exported for tests.
export function resolveOptions(options = {}) {
  const apiUrl = normalizeApiUrl(
    options.apiUrl ?? process.env.KANEO_DEMO_API_URL ?? DEFAULT_API_URL,
  );
  const local = isLocalUrl(apiUrl);
  if (!local && !options.allowRemote) {
    throw new Error(
      `Refusing to seed ${apiUrl}: it is not localhost. The seed creates accounts with a known password and deletes the demo workspace on --reset, so use it only on a dedicated demo instance, never on production. Pass --allow-remote to confirm this is one.`,
    );
  }
  const password =
    options.password ??
    process.env.KANEO_DEMO_PASSWORD ??
    (local ? demo.DEFAULT_PASSWORD : undefined);
  if (!password) {
    throw new Error(
      `${apiUrl} is not localhost: pass --password or set KANEO_DEMO_PASSWORD. The built-in password is only allowed for localhost and 127.0.0.1.`,
    );
  }
  if (!local && (password === demo.DEFAULT_PASSWORD || password.length < 12)) {
    throw new Error(
      "A remote demo instance needs its own password of at least 12 characters (not the built-in one).",
    );
  }
  const anchor = options.anchor ?? demo.defaultAnchor();
  demo.parseAnchor(anchor);
  const layers = normalizeLayers(options.layers);
  if (options.reset && !layers.includes("base")) {
    throw new Error(
      "--reset deletes the workspace and so needs the base layer (--layers base or base,pro)",
    );
  }
  return {
    apiUrl,
    origin: options.origin ?? new URL(apiUrl).origin,
    password,
    anchor,
    layers,
    reset: Boolean(options.reset),
    local,
    log: options.log ?? (() => {}),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TASKS = new Map(demo.tasks.map((task) => [task.key, task]));

const isoDate = (day) => `${day}T00:00:00.000Z`;

// Kaneo stores the working days as a bitmask: bit 0 is Sunday ... bit 6 is
// Saturday. The dataset counts Monday = 1 ... Sunday = 7.
function workingDaysMask(days) {
  return days.reduce((mask, day) => mask | (1 << (day % 7)), 0);
}

// The tasks of a project as GET /api/task/tasks/{projectId} returns them:
// { data: { columns: [{ tasks }], plannedTasks, archivedTasks } }.
function flattenTasks(response) {
  const projectData = response.data ?? response;
  const seen = new Map();
  const lists = [
    ...(projectData.columns ?? []).map((column) => column.tasks ?? []),
    projectData.plannedTasks ?? [],
    projectData.archivedTasks ?? [],
  ];
  for (const list of lists) {
    for (const task of list) seen.set(task.id, task);
  }
  return [...seen.values()];
}

class Seeder {
  constructor(options) {
    this.options = options;
    this.log = options.log;
    this.dates = demo.resolveDates(options.anchor);
    this.layer = "base";
    this.clients = {};
    this.config = null;
    this.ids = {
      workspace: null,
      users: {},
      workspaceInvitations: {},
      projects: {},
      columns: {},
      labels: {},
      customFields: {},
      resources: {},
      tasks: {},
      relations: {},
      comments: [],
      timeEntries: {},
      externalLinks: {},
      calendarFeeds: {},
      projectInvitations: {},
      holidays: [],
    };
    // Base assignments a Pro target refused because the person was not yet a
    // project member; `reconcileAssignees` finishes them.
    this.deferred = [];
  }

  client(label) {
    return new ApiClient({
      baseUrl: this.options.apiUrl,
      origin: this.options.origin,
      label,
      guard: (method, path, details) => {
        if (this.layer === "base") {
          assertUpstreamRequest(method, path, details);
        }
      },
    });
  }

  get owner() {
    return this.clients[demo.users[0].key];
  }

  userId(key) {
    return this.ids.users[key].id;
  }

  async as(layer, fn) {
    const previous = this.layer;
    this.layer = layer;
    try {
      return await fn();
    } finally {
      this.layer = previous;
    }
  }

  // --- preflight ---------------------------------------------------------

  async preflight() {
    const probe = this.client("preflight");
    let lastError;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const health = await probe.get("/api/health");
        if (health?.status === "ok") break;
      } catch (error) {
        lastError = error;
      }
      if (attempt === 29) {
        throw new Error(
          `The API at ${this.options.apiUrl} is not reachable: ${lastError?.message ?? "unhealthy"}`,
        );
      }
      await sleep(1000);
    }
    this.config = await probe.get("/api/config");
  }

  // --- base: accounts, workspace, members ---------------------------------

  async accounts() {
    // What to tell the person when the API refuses a sign-up or a sign-in.
    const refused = (data) => {
      if (data?.code === "INVALID_ORIGIN") {
        return new Error(
          `${this.options.apiUrl} does not accept the Origin "${this.options.origin}". Pass --origin with the address of the web app (the instance's KANEO_CLIENT_URL).`,
        );
      }
      const reason = data?.message ? ` ("${data.message}")` : "";
      return new Error(
        `Sign-up is disabled on ${this.options.apiUrl}${reason}, so the demo accounts cannot be created. Allow registration while the seed runs (no DISABLE_REGISTRATION or DISABLE_PASSWORD_REGISTRATION), or create the accounts listed in scripts/demo/data.mjs by hand first.`,
      );
    };
    for (const user of demo.users) {
      const client = this.client(user.key);
      const credentials = {
        email: user.email,
        password: this.options.password,
      };
      let signedIn;
      if (!this.config.disablePasswordRegistration) {
        const created = await client.request(
          "POST",
          "/api/auth/sign-up/email",
          {
            body: { name: user.name, ...credentials },
            allow: [400, 403, 409, 422],
          },
        );
        if (created.ok) {
          signedIn = created.data;
        } else if (/already exists/i.test(JSON.stringify(created.data))) {
          // The account exists from an earlier run: sign in below.
        } else if (created.status === 403) {
          throw refused(created.data);
        } else {
          throw new ApiError(
            `${user.key}: sign-up failed (${created.status}) ${JSON.stringify(created.data)}`,
            {
              status: created.status,
              method: "POST",
              path: "/api/auth/sign-up/email",
              data: created.data,
            },
          );
        }
      }
      if (!signedIn) {
        const res = await client.request("POST", "/api/auth/sign-in/email", {
          body: credentials,
          allow: [400, 401, 403],
        });
        if (!res.ok) {
          if (
            res.data?.code === "INVALID_ORIGIN" ||
            this.config.disablePasswordRegistration
          ) {
            throw refused(res.data);
          }
          throw new Error(
            `${user.email} exists on ${this.options.apiUrl} but the password is wrong (${res.status}). Pass the password that was used when the demo was first seeded.${this.config.hasSmtp ? " SMTP is configured: set DISABLE_EMAIL_OTP_SIGN_IN=true if password sign-in is off." : ""}`,
          );
        }
        signedIn = res.data;
      }
      this.clients[user.key] = client;
      this.ids.users[user.key] = {
        id: signedIn.user.id,
        layer: "base",
        name: user.name,
        email: user.email,
        workspaceRole: user.workspaceRole,
      };
      this.log(`  account ${user.email}`);
    }
  }

  async workspace() {
    const owner = this.owner;
    const organizations = await owner.get("/api/auth/organization/list");
    const existing = (organizations ?? []).find(
      (organization) => organization.slug === demo.COMPANY.slug,
    );
    if (existing) {
      if (!this.options.reset) {
        throw new Error(
          `The demo workspace "${demo.COMPANY.name}" already exists on ${this.options.apiUrl}. Pass --reset to delete it and seed again.`,
        );
      }
      const full = await owner.get(
        "/api/auth/organization/get-full-organization",
        {
          query: { organizationId: existing.id },
        },
      );
      const ownerMember = (full.members ?? []).find(
        (member) => member.userId === this.userId(demo.users[0].key),
      );
      if (
        ownerMember?.role !== "owner" ||
        existing.name !== demo.COMPANY.name
      ) {
        throw new Error(
          `Refusing to delete workspace ${existing.id}: it is not owned by ${demo.users[0].email} or not named "${demo.COMPANY.name}".`,
        );
      }
      await owner.post("/api/auth/organization/delete", {
        organizationId: existing.id,
      });
      this.log("  deleted the previous demo workspace");
    }
    let created;
    try {
      created = await owner.post("/api/auth/organization/create", {
        name: demo.COMPANY.name,
        slug: demo.COMPANY.slug,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        throw new Error(
          `${demo.users[0].email} may not create a workspace on ${this.options.apiUrl}. With DISABLE_WORKSPACE_CREATION=true only the instance administrator can, and that is the first account ever created on an instance: seed into a fresh database.`,
          { cause: error },
        );
      }
      throw error;
    }
    this.ids.workspace = {
      id: created.id,
      layer: "base",
      name: demo.COMPANY.name,
      slug: demo.COMPANY.slug,
    };
    this.log(`  workspace ${created.id}`);
  }

  // Members join through invitations, as upstream has no other way. It also
  // works where the user directory is switched off.
  async members() {
    const workspaceId = this.ids.workspace.id;
    for (const user of demo.users.slice(1)) {
      const invitation = await this.owner.post(
        "/api/auth/organization/invite-member",
        {
          email: user.email,
          role: user.workspaceRole,
          organizationId: workspaceId,
        },
      );
      await this.clients[user.key].post(
        "/api/auth/organization/accept-invitation",
        { invitationId: invitation.id },
      );
      this.log(`  member ${user.email} (${user.workspaceRole})`);
    }
  }

  async workspaceInvitations() {
    for (const invitation of demo.workspaceInvitations) {
      const created = await this.owner.post(
        "/api/auth/organization/invite-member",
        {
          email: invitation.email,
          role: invitation.workspaceRole,
          organizationId: this.ids.workspace.id,
        },
      );
      this.ids.workspaceInvitations[invitation.key] = {
        id: created.id,
        layer: "base",
        email: invitation.email,
      };
    }
  }

  // --- base: projects, columns, labels, fields ------------------------------

  async projects() {
    for (const project of demo.projects) {
      const created = await this.owner.post("/api/project", {
        name: project.name,
        workspaceId: this.ids.workspace.id,
        icon: project.icon,
        slug: project.slug,
      });
      this.ids.projects[project.key] = {
        id: created.id,
        layer: "base",
        name: project.name,
        slug: project.slug,
      };
    }
    this.log(`  ${demo.projects.length} projects`);
  }

  async columns() {
    for (const column of demo.columns) {
      const created = await this.owner.post(
        `/api/column/${this.ids.projects[column.project].id}`,
        { name: column.name, color: column.color },
      );
      this.ids.columns[column.key] = { id: created.id, layer: "base" };
    }
  }

  async labels() {
    for (const label of demo.labels) {
      const created = await this.owner.post("/api/label", {
        name: label.name,
        color: label.color,
        workspaceId: this.ids.workspace.id,
      });
      this.ids.labels[label.key] = { id: created.id, layer: "base" };
    }
  }

  async projectCustomFields() {
    for (const field of demo.customFields) {
      const created = await this.owner.post("/api/custom-field", {
        projectId: this.ids.projects[field.project].id,
        name: field.name,
        type: field.type,
        ...(field.options ? { options: field.options } : {}),
      });
      this.ids.customFields[field.key] = {
        id: created.id,
        layer: "base",
        scope: "project",
      };
    }
  }

  // --- base: tasks and what hangs on them -----------------------------------

  async tasks() {
    for (const task of demo.tasks) {
      const projectId = this.ids.projects[task.project].id;
      const dates = this.dates.tasks[task.key];
      const body = {
        title: task.title,
        description: task.description,
        startDate: isoDate(dates.start),
        dueDate: isoDate(dates.due),
        priority: task.priority,
        status: task.status,
      };
      let created;
      if (task.assignee) {
        try {
          created = await this.owner.post(`/api/task/${projectId}`, {
            ...body,
            userId: this.userId(task.assignee),
          });
        } catch (error) {
          // Kaneo Pro only assigns project members, and the Pro layer adds the
          // memberships. Upstream never refuses, so this is Pro-only.
          if (!(error instanceof ApiError && error.status === 403)) throw error;
          created = await this.owner.post(`/api/task/${projectId}`, body);
          this.deferred.push({ task: task.key, user: task.assignee });
        }
      } else {
        created = await this.owner.post(`/api/task/${projectId}`, body);
      }
      this.ids.tasks[task.key] = {
        id: created.id,
        layer: "base",
        project: task.project,
        title: task.title,
        number: created.number,
      };
      for (const label of task.labels ?? []) {
        await this.owner.put(`/api/label/${this.ids.labels[label].id}/task`, {
          taskId: created.id,
        });
      }
      for (const [fieldKey, value] of Object.entries(task.fields ?? {})) {
        await this.owner.put("/api/custom-field/value", {
          taskId: created.id,
          fieldId: this.ids.customFields[fieldKey].id,
          value: String(value),
        });
      }
    }
    this.log(`  ${demo.tasks.length} tasks`);
    if (this.deferred.length > 0) {
      this.log(
        `  ${this.deferred.length} assignments wait for the Pro layer (project memberships)`,
      );
    }
  }

  async relations() {
    for (const relation of demo.relations) {
      const created = await this.owner.post("/api/task-relation", {
        sourceTaskId: this.ids.tasks[relation.from].id,
        targetTaskId: this.ids.tasks[relation.to].id,
        relationType: relation.type,
      });
      this.ids.relations[`${relation.type}:${relation.from}>${relation.to}`] = {
        id: created.id,
        layer: "base",
      };
    }
    this.log(`  ${demo.relations.length} relations`);
  }

  async timeEntries() {
    for (const entry of demo.timeEntries) {
      const created = await this.clients[entry.by].post("/api/time-entry", {
        taskId: this.ids.tasks[entry.task].id,
        startTime: demo.resolveTimestamp(this.options.anchor, entry.start),
        endTime: demo.resolveTimestamp(this.options.anchor, entry.end),
        description: entry.description,
      });
      this.ids.timeEntries[entry.key] = { id: created.id, layer: "base" };
    }
  }

  async externalLinks() {
    for (const link of demo.externalLinks) {
      const created = await this.owner.post(
        `/api/external-link/task/${this.ids.tasks[link.task].id}`,
        { url: link.url, title: link.title },
      );
      this.ids.externalLinks[link.key] = { id: created.id, layer: "base" };
    }
  }

  async calendarFeeds() {
    for (const feed of demo.calendarFeeds) {
      const created = await this.owner.post(
        `/api/calendar-feed/project/${this.ids.projects[feed.project].id}`,
        {
          labelIds: feed.labels.map((label) => this.ids.labels[label].id),
          timeZone: "UTC",
        },
      );
      this.ids.calendarFeeds[feed.key] = { id: created.id, layer: "base" };
    }
  }

  async activity(layer) {
    for (const step of demo.activity.filter((entry) => entry.layer === layer)) {
      const client = this.clients[step.by];
      const taskId = this.ids.tasks[step.task].id;
      if (step.type === "comment") {
        const created = await client.post(`/api/comment/${taskId}`, {
          content: step.text,
        });
        this.ids.comments.push({
          id: created.id,
          layer,
          task: step.task,
          by: step.by,
        });
      } else if (step.type === "status") {
        await client.put(`/api/task/status/${taskId}`, { status: step.status });
      } else if (step.type === "priority") {
        await client.put(`/api/task/priority/${taskId}`, {
          priority: step.priority,
        });
      } else if (step.type === "slip") {
        const dates = this.dates.tasks[step.task];
        await client.patch("/api/task/bulk", {
          taskIds: [taskId],
          operation: "updateSchedule",
          scheduleUpdates: [
            {
              taskId,
              startDate: isoDate(dates.start),
              dueDate: isoDate(dates.due),
            },
          ],
        });
      }
    }
  }

  // --- pro --------------------------------------------------------------------

  // Kaneo Pro only assigns people who can open the project.
  async projectMembers() {
    for (const member of demo.projectMembers) {
      const projectId = this.ids.projects[member.project].id;
      const userId = this.userId(member.user);
      const res = await this.owner.request(
        "POST",
        `/api/project/${projectId}/members`,
        { body: { userId, role: member.role }, allow: [409] },
      );
      if (res.status === 409) {
        await this.owner.patch(`/api/project/${projectId}/members/${userId}`, {
          role: member.role,
        });
      }
    }
    this.log(`  ${demo.projectMembers.length} project memberships`);
  }

  // Finishes base assignments that had to wait for a project membership.
  async reconcileAssignees() {
    for (const project of demo.projects) {
      const data = await this.owner.get(
        `/api/task/tasks/${this.ids.projects[project.key].id}`,
      );
      const assigned = new Map(
        flattenTasks(data).map((task) => [task.id, task.userId]),
      );
      for (const task of demo.tasks.filter(
        (entry) => entry.project === project.key && entry.assignee,
      )) {
        const id = this.ids.tasks[task.key].id;
        if (assigned.get(id)) continue;
        await this.owner.put(`/api/task/assignee/${id}`, {
          userId: this.userId(task.assignee),
        });
      }
    }
    this.deferred = [];
  }

  async calendar() {
    const workspaceId = this.ids.workspace.id;
    await this.owner.put(`/api/calendar/${workspaceId}`, {
      workingDays: workingDaysMask(demo.calendar.workingDays),
    });
    for (const holiday of this.dates.holidays) {
      const created = await this.owner.post(
        `/api/calendar/${workspaceId}/holidays`,
        { date: holiday.date, name: holiday.name },
      );
      this.ids.holidays.push({
        id: created?.id,
        layer: "pro",
        name: holiday.name,
        date: holiday.date,
      });
    }
    await this.owner.patch(`/api/workspace/${workspaceId}/activity-retention`, {
      activityRetentionDays: demo.activityRetention.days,
    });
  }

  async workspaceCustomFields() {
    for (const field of demo.workspaceCustomFields) {
      const created = await this.owner.post(
        `/api/custom-field/workspace/${this.ids.workspace.id}`,
        {
          name: field.name,
          type: field.type,
          ...(field.options ? { options: field.options } : {}),
          ...(field.optionColors ? { optionColors: field.optionColors } : {}),
        },
      );
      this.ids.customFields[field.key] = {
        id: created.id,
        layer: "pro",
        scope: "workspace",
      };
    }
  }

  async resources() {
    for (const resource of demo.resources) {
      const created = await this.owner.post(
        `/api/resource/workspace/${this.ids.workspace.id}`,
        {
          kind: resource.kind,
          name: resource.name,
          ...(resource.email ? { email: resource.email } : {}),
        },
      );
      this.ids.resources[resource.key] = { id: created.id, layer: "pro" };
    }
  }

  // The Pro attributes of each task. The order matters: the task update comes
  // first because it resets the assignees to the single base assignee, and the
  // plan move comes last because the baseline snapshots the current dates.
  async taskPro() {
    for (const entry of demo.taskPro) {
      const id = this.ids.tasks[entry.task].id;
      const task = TASKS.get(entry.task);
      if (entry.progress !== undefined || entry.milestone || entry.constraint) {
        const current = await this.owner.get(`/api/task/${id}`);
        await this.owner.put(`/api/task/${id}`, {
          title: current.title,
          description: current.description,
          startDate: current.startDate,
          dueDate: current.dueDate,
          priority: current.priority,
          status: current.status,
          projectId: current.projectId,
          position: current.position,
          ...(current.userId ? { userId: current.userId } : {}),
          progress: entry.progress ?? current.progress ?? 0,
          isMilestone: entry.milestone ?? current.isMilestone ?? false,
          ...(entry.constraint
            ? {
                constraintType: entry.constraint.type,
                constraintDate: isoDate(
                  this.dates.tasks[entry.task].constraintDate,
                ),
              }
            : {}),
        });
      }
      for (const [fieldKey, value] of Object.entries(entry.fields ?? {})) {
        await this.owner.put("/api/custom-field/value", {
          taskId: id,
          fieldId: this.ids.customFields[fieldKey].id,
          value: String(value),
        });
      }
      if (entry.approval) {
        await this.owner.put(`/api/task/approval/${id}`, {
          approvalStatus: entry.approval.status,
          approvalNote: entry.approval.note,
        });
      }
      if (entry.assignees || entry.resources) {
        const people =
          entry.assignees ?? (task.assignee ? [task.assignee] : []);
        await this.owner.put(`/api/task/${id}/assignees`, {
          userIds: people.map((user) => this.userId(user)),
          resourceIds: (entry.resources ?? []).map(
            (resource) => this.ids.resources[resource].id,
          ),
        });
      }
      const dates = this.dates.tasks[entry.task];
      if (
        entry.plan &&
        (dates.planStart !== dates.start || dates.planDue !== dates.due)
      ) {
        await this.owner.patch("/api/task/bulk", {
          taskIds: [id],
          operation: "updateSchedule",
          scheduleUpdates: [
            {
              taskId: id,
              startDate: isoDate(dates.planStart),
              dueDate: isoDate(dates.planDue),
            },
          ],
        });
      }
      if (entry.baseline) {
        await this.owner.post(`/api/task/${id}/baseline`, {});
      }
    }
    this.log(`  ${demo.taskPro.length} tasks extended`);
  }

  async dependencies() {
    // The relation ids come from the base step, or from the API when the base
    // layer was seeded by an earlier run.
    for (const dependency of demo.dependencies) {
      const relation =
        this.ids.relations[`blocks:${dependency.from}>${dependency.to}`];
      if (!relation) {
        throw new Error(
          `No blocks relation ${dependency.from} > ${dependency.to}: seed the base layer first`,
        );
      }
      await this.owner.patch(`/api/task-relation/${relation.id}`, {
        dependencyType: dependency.type,
        lagDays: dependency.lag,
      });
    }
  }

  async projectInvitations() {
    for (const invitation of demo.projectInvitations) {
      const created = await this.owner.post(
        `/api/project/${this.ids.projects[invitation.project].id}/invitations`,
        {
          email: invitation.email,
          workspaceRole: invitation.workspaceRole,
          projectRole: invitation.projectRole,
        },
      );
      this.ids.projectInvitations[invitation.key] = {
        id: created.id,
        layer: "pro",
        email: invitation.email,
      };
    }
  }

  // --- a Pro run on top of an existing base seed ---------------------------

  // Finds the entities of an earlier base run by name (or by the ids of its
  // --out file, `hint`, when they still exist).
  async discoverBase(hint) {
    const owner = this.owner;
    const organizations = await owner.get("/api/auth/organization/list");
    const workspace = (organizations ?? []).find(
      (organization) => organization.slug === demo.COMPANY.slug,
    );
    if (!workspace) {
      throw new Error(
        `The base layer is not seeded on ${this.options.apiUrl}: there is no workspace "${demo.COMPANY.name}". Run with --layers base first.`,
      );
    }
    this.ids.workspace = {
      id:
        hint?.workspace?.id === workspace.id ? hint.workspace.id : workspace.id,
      layer: "base",
      name: demo.COMPANY.name,
      slug: demo.COMPANY.slug,
    };
    const projects = await owner.get("/api/project", {
      query: { workspaceId: workspace.id },
    });
    for (const project of demo.projects) {
      const found = projects.find((entry) => entry.name === project.name);
      if (!found) {
        throw new Error(
          `Base project "${project.name}" is missing: seed the base layer first`,
        );
      }
      this.ids.projects[project.key] = {
        id: found.id,
        layer: "base",
        name: project.name,
        slug: project.slug,
      };
      const data = await owner.get(`/api/task/tasks/${found.id}`);
      const byTitle = new Map(
        flattenTasks(data).map((task) => [task.title, task]),
      );
      for (const task of demo.tasks.filter(
        (entry) => entry.project === project.key,
      )) {
        const existing = byTitle.get(task.title);
        if (!existing) {
          throw new Error(
            `Base task "${task.title}" is missing: seed the base layer first`,
          );
        }
        this.ids.tasks[task.key] = {
          id: existing.id,
          layer: "base",
          project: task.project,
          title: task.title,
          number: existing.number,
        };
      }
    }
    const labels = await owner.get(`/api/label/workspace/${workspace.id}`);
    for (const label of demo.labels) {
      const found = labels.find((entry) => entry.name === label.name);
      if (found) this.ids.labels[label.key] = { id: found.id, layer: "base" };
    }
    // Relations are read from the Pro project route, which lists them all.
    for (const project of demo.projects) {
      const list = await owner.get(
        `/api/task-relation/project/${this.ids.projects[project.key].id}`,
      );
      const keyById = new Map(
        Object.entries(this.ids.tasks).map(([key, value]) => [value.id, key]),
      );
      for (const relation of list) {
        const from = keyById.get(relation.sourceTaskId);
        const to = keyById.get(relation.targetTaskId);
        if (from && to) {
          this.ids.relations[`${relation.relationType}:${from}>${to}`] = {
            id: relation.id,
            layer: "base",
          };
        }
      }
    }
    for (const field of demo.customFields) {
      const fields = await owner.get(
        `/api/custom-field/project/${this.ids.projects[field.project].id}`,
      );
      const found = fields.find(
        (entry) => entry.name === field.name && !entry.workspaceId,
      );
      if (found) {
        this.ids.customFields[field.key] = {
          id: found.id,
          layer: "base",
          scope: "project",
        };
      }
    }
  }

  // The Pro routes exist only on Kaneo Pro: fail with a clear message if not.
  async assertPro() {
    const res = await this.owner.request(
      "GET",
      `/api/calendar/${this.ids.workspace.id}`,
      { allow: [404] },
    );
    if (res.status === 404) {
      throw new Error(
        `${this.options.apiUrl} has no working calendar API: it does not look like Kaneo Pro, so the pro layer cannot be seeded there.`,
      );
    }
    const existing = res.data;
    if (existing?.holidays?.length > 0) {
      throw new Error(
        "The pro layer is already seeded in this workspace. Seed again with --reset (base and pro) instead of adding it twice.",
      );
    }
  }

  // --- verification -----------------------------------------------------------

  async verify() {
    const problems = [];
    const expect = (what, actual, expected) => {
      if (actual !== expected) {
        problems.push(`${what}: expected ${expected}, found ${actual}`);
      }
    };
    const workspaceId = this.ids.workspace.id;
    const members = await this.owner.get(
      `/api/workspace/${workspaceId}/members`,
    );
    expect(
      "workspace members",
      (members.members ?? members).length,
      demo.users.length,
    );
    for (const project of demo.projects) {
      const data = await this.owner.get(
        `/api/task/tasks/${this.ids.projects[project.key].id}`,
      );
      const expected = demo.tasks.filter(
        (task) => task.project === project.key,
      );
      const found = flattenTasks(data);
      expect(`tasks of ${project.name}`, found.length, expected.length);
      const waiting = new Set(this.deferred.map((entry) => entry.task));
      for (const task of expected.filter(
        (entry) => entry.assignee && !waiting.has(entry.key),
      )) {
        const current = found.find((entry) => entry.title === task.title);
        if (!current?.userId) {
          problems.push(`task "${task.title}" has no assignee`);
        }
      }
    }
    if (this.options.layers.includes("pro")) {
      const calendar = await this.owner.get(`/api/calendar/${workspaceId}`);
      expect(
        "holidays",
        calendar.holidays.length,
        demo.calendar.holidays.length,
      );
      const resources = await this.owner.get(
        `/api/resource/workspace/${workspaceId}`,
      );
      expect("resources", resources.length, demo.resources.length);
      const fields = await this.owner.get(
        `/api/custom-field/workspace/${workspaceId}`,
      );
      expect(
        "workspace custom fields",
        fields.length,
        demo.workspaceCustomFields.length,
      );
      for (const project of demo.projects) {
        const list = await this.owner.get(
          `/api/task-relation/project/${this.ids.projects[project.key].id}`,
        );
        for (const relation of list) {
          const from = relation.sourceTask?.title;
          const to = relation.targetTask?.title;
          const wanted = demo.dependencies.find(
            (entry) =>
              TASKS.get(entry.from).title === from &&
              TASKS.get(entry.to).title === to,
          );
          if (wanted && relation.relationType === "blocks") {
            expect(
              `dependency ${from} > ${to}`,
              `${relation.dependencyType}+${relation.lagDays}`,
              `${wanted.type}+${wanted.lag}`,
            );
          }
        }
      }
    }
    if (problems.length > 0) {
      throw new Error(
        `The seed did not produce the expected data:\n- ${problems.join("\n- ")}`,
      );
    }
  }

  // --- notifications ----------------------------------------------------------

  // The seed acts as several people, so their accounts collect notifications
  // (assignments, comments, status changes) and the demo would open with a
  // badge saying "6 new". The server raises a notification a moment after the
  // request that caused it: wait, then mark everything read, and look again.
  async readNotifications() {
    await sleep(1000);
    for (const user of demo.users) {
      const client = this.clients[user.key];
      for (let round = 0; round < 5; round++) {
        await client.patch("/api/notification/read-all");
        const notifications = await client.get("/api/notification");
        if (!(notifications ?? []).some((entry) => !entry.isRead)) break;
        await sleep(500);
      }
    }
  }

  // The ids of a Pro run on top of a base run: what the base run wrote (its
  // --out file) plus what this run found and created.
  result(hint) {
    const ids = { ...this.ids };
    if (hint && !this.options.layers.includes("base")) {
      for (const kind of [
        "workspaceInvitations",
        "columns",
        "timeEntries",
        "externalLinks",
        "calendarFeeds",
      ]) {
        ids[kind] = { ...(hint[kind] ?? {}), ...ids[kind] };
      }
      ids.comments = [
        ...(hint.comments ?? []).filter((comment) => comment.layer === "base"),
        ...ids.comments,
      ];
    }
    return {
      anchor: this.options.anchor,
      apiUrl: this.options.apiUrl,
      layers:
        hint && !this.options.layers.includes("base")
          ? demo.LAYERS
          : this.options.layers,
      ...(this.options.local ? { password: this.options.password } : {}),
      ...ids,
    };
  }
}

// ---------------------------------------------------------------------------
// The seed
// ---------------------------------------------------------------------------

// Seeds the demo data. Returns the ids of everything it created, by key, each
// with the layer that created it. Safe to call from a Playwright globalSetup.
//
// options: apiUrl, origin, password, anchor, layers ("base", "pro" or
// "base,pro"), reset, allowRemote, hint (ids of an earlier run), log.
export async function seedDemo(options = {}) {
  const resolved = resolveOptions(options);
  const seeder = new Seeder(resolved);
  const wants = (layer) => resolved.layers.includes(layer);
  const run = async (layer, title, fn) => {
    if (!wants(layer)) return;
    resolved.log(`[${layer}] ${title}`);
    await seeder.as(layer, fn);
  };

  resolved.log(
    `Seeding ${resolved.apiUrl} (layers: ${resolved.layers.join(", ")}, anchor ${resolved.anchor})`,
  );
  await seeder.as("base", () => seeder.preflight());
  await seeder.as("base", () => seeder.accounts());

  if (wants("base")) {
    await run("base", "workspace", () => seeder.workspace());
    await run("base", "members", () => seeder.members());
    await run("base", "workspace invitations", () =>
      seeder.workspaceInvitations(),
    );
    await run("base", "projects", () => seeder.projects());
    await run("base", "columns", () => seeder.columns());
  } else {
    await seeder.as("pro", () => seeder.discoverBase(options.hint));
  }
  if (wants("pro")) {
    await run("pro", "check the target", () => seeder.assertPro());
    await run("pro", "project memberships", () => seeder.projectMembers());
  }
  await run("base", "labels", () => seeder.labels());
  await run("base", "project custom fields", () =>
    seeder.projectCustomFields(),
  );
  await run("base", "tasks", () => seeder.tasks());
  await run("base", "relations", () => seeder.relations());
  await run("base", "time entries", () => seeder.timeEntries());
  await run("base", "external links", () => seeder.externalLinks());
  await run("base", "calendar feeds", () => seeder.calendarFeeds());
  await run("base", "activity", () => seeder.activity("base"));
  if (wants("pro")) {
    await run("pro", "base assignments", () => seeder.reconcileAssignees());
    await run("pro", "working calendar", () => seeder.calendar());
    await run("pro", "workspace custom fields", () =>
      seeder.workspaceCustomFields(),
    );
    await run("pro", "resources", () => seeder.resources());
    await run("pro", "task attributes", () => seeder.taskPro());
    await run("pro", "dependency types", () => seeder.dependencies());
    await run("pro", "activity", () => seeder.activity("pro"));
    await run("pro", "project invitations", () => seeder.projectInvitations());
  }
  await seeder.as(wants("pro") ? "pro" : "base", () => seeder.verify());
  // Both notification routes exist upstream, so this step is always guarded as
  // a base step, also in a Pro-only run.
  resolved.log("[base] notifications");
  await seeder.as("base", () => seeder.readNotifications());
  resolved.log("Done.");
  return seeder.result(options.hint);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `Seed the fictional Northwind Robotics demo workspace through the HTTP API.

Usage: node scripts/demo/seed.mjs [options]

  --api-url <url>     API origin (default ${DEFAULT_API_URL}, or KANEO_DEMO_API_URL)
  --origin <url>      Origin header to send; set it to the instance's public URL
                      (KANEO_CLIENT_URL) when the API runs behind another address
  --password <text>   password of the demo accounts (or KANEO_DEMO_PASSWORD);
                      the built-in one is only allowed for localhost
  --anchor <date>     Monday all dates are counted from (default: this week's)
  --layers <list>     base, pro or base,pro (default): see README.md
  --reset             delete the existing demo workspace first (needs base)
  --out <file>        write the ids of everything created, by key, as JSON
  --allow-remote      required when the API is not localhost
  --quiet             print nothing but errors
  --help              show this help
`;

async function main() {
  const { values } = parseArgs({
    options: {
      "api-url": { type: "string" },
      origin: { type: "string" },
      password: { type: "string" },
      anchor: { type: "string" },
      layers: { type: "string" },
      out: { type: "string" },
      reset: { type: "boolean" },
      "allow-remote": { type: "boolean" },
      quiet: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  let hint;
  if (values.out) {
    try {
      hint = JSON.parse(readFileSync(resolve(values.out), "utf8"));
    } catch {
      hint = undefined;
    }
  }
  const result = await seedDemo({
    apiUrl: values["api-url"],
    origin: values.origin,
    password: values.password,
    anchor: values.anchor,
    layers: values.layers,
    reset: values.reset,
    allowRemote: values["allow-remote"],
    hint,
    log: values.quiet ? undefined : (line) => console.log(line),
  });
  if (values.out) {
    const file = resolve(values.out);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`Wrote ${file}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  });
}
