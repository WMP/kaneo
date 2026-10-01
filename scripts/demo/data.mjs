// Fictional demo dataset for Kaneo ("Northwind Robotics"). Pure data: no I/O and
// no dependencies, so it can be imported by the seed script, the screenshot
// script, end-to-end tests and the dataset test alike.
//
// Dates are day offsets from an anchor (a Monday). `resolveDates()` turns them
// into ISO dates for a concrete anchor; the default anchor is the Monday of the
// current week, so a demo instance always looks current.
//
// Layers. Every entity carries `layer: "base"` or `layer: "pro"`.
// - "base" is what upstream Kaneo v2.29.3 supports: accounts, the workspace and
//   its members with the built-in roles, a pending workspace invitation,
//   projects, columns, labels, tasks (title, description, status, priority,
//   start and due date, ONE assignee), comments, time entries, external links,
//   blocks/subtask/related relations, project-level custom fields and their
//   values, and a calendar feed. A base entity may only use the fields listed
//   in BASE_FIELDS (and the scripts/demo test enforces it).
// - "pro" is everything else: progress, milestones, baselines, date
//   constraints, approval gates, dependency types and lags, the working
//   calendar and holidays, workspace custom fields, several assignees and
//   resources, project memberships and invitations, and the activity retention
//   setting. Pro data refers to base entities by key and never changes a base
//   field.

export const LAYERS = ["base", "pro"];

export const COMPANY = {
  layer: "base",
  name: "Northwind Robotics",
  slug: "northwind-robotics",
};

// Only allowed on localhost or 127.0.0.1 (see seed.mjs); a remote instance
// needs its own password.
export const DEFAULT_PASSWORD = "DemoPass123!";

// Day offset of a weekday in a week counted from the anchor Monday.
// weekday: 1 = Monday ... 7 = Sunday.
const at = (week, weekday) => week * 7 + (weekday - 1);

// The fields each kind of base entity may use. Anything else is Pro.
export const BASE_FIELDS = {
  users: ["key", "layer", "name", "email", "workspaceRole"],
  workspaceInvitations: ["key", "layer", "email", "workspaceRole"],
  projects: ["key", "layer", "name", "icon", "slug"],
  columns: ["key", "layer", "project", "name", "color"],
  labels: ["key", "layer", "name", "color"],
  customFields: ["key", "layer", "scope", "project", "name", "type", "options"],
  tasks: [
    "key",
    "layer",
    "project",
    "title",
    "description",
    "status",
    "priority",
    "start",
    "due",
    "assignee",
    "labels",
    "fields",
  ],
  relations: ["layer", "from", "to", "type"],
  timeEntries: ["key", "layer", "task", "by", "start", "end", "description"],
  externalLinks: ["key", "layer", "task", "url", "title"],
  calendarFeeds: ["key", "layer", "project", "labels"],
  activity: ["layer", "type", "by", "task", "text", "status", "priority"],
};

// Values a base entity may take where upstream restricts them.
export const BASE_WORKSPACE_ROLES = ["owner", "admin", "member", "viewer"];
export const BASE_RELATION_TYPES = ["blocks", "subtask", "related"];
export const BASE_ACTIVITY_TYPES = ["comment", "status", "priority"];

export const DEFAULT_COLUMNS = [
  { name: "To Do", slug: "to-do" },
  { name: "In Progress", slug: "in-progress" },
  { name: "In Review", slug: "in-review" },
  { name: "Done", slug: "done" },
];

export const DEPENDENCY_TYPES = ["fs", "ss", "ff", "sf"];

// ---------------------------------------------------------------------------
// Base layer
// ---------------------------------------------------------------------------

// The first account becomes the instance administrator on a fresh instance, so
// the owner must stay first. Base actors (comments, status changes, time
// entries) are limited to the owner and the admin, who can act in every
// project without a project membership.
export const users = [
  {
    key: "claire",
    layer: "base",
    name: "Claire Donovan",
    email: "claire@example.com",
    workspaceRole: "owner",
  },
  {
    key: "marcus",
    layer: "base",
    name: "Marcus Reyes",
    email: "marcus@example.com",
    workspaceRole: "admin",
  },
  {
    key: "aisha",
    layer: "base",
    name: "Aisha Rahman",
    email: "aisha@example.com",
    workspaceRole: "member",
  },
  {
    key: "tom",
    layer: "base",
    name: "Tom Becker",
    email: "tom@example.com",
    workspaceRole: "viewer",
  },
];

// A workspace invitation that nobody accepts.
export const workspaceInvitations = [
  {
    key: "nina",
    layer: "base",
    email: "nina.park@example.com",
    workspaceRole: "member",
  },
];

export const projects = [
  {
    key: "warehouseRobot",
    layer: "base",
    name: "Warehouse Robot v2",
    icon: "Boxes",
    slug: "WRV",
  },
  {
    key: "firmware",
    layer: "base",
    name: "Firmware Platform",
    icon: "CircuitBoard",
    slug: "FWP",
  },
  {
    key: "pilot",
    layer: "base",
    name: "Pilot Rollout",
    icon: "Rocket",
    slug: "PRO",
  },
];

// Columns beyond the four defaults (DEFAULT_COLUMNS).
export const columns = [
  {
    key: "blocked",
    layer: "base",
    project: "firmware",
    name: "Blocked",
    color: "red",
  },
];

export const labels = [
  { key: "hardware", layer: "base", name: "Hardware", color: "orange" },
  { key: "software", layer: "base", name: "Software", color: "purple" },
  { key: "safety", layer: "base", name: "Safety", color: "red" },
  { key: "vendor", layer: "base", name: "Vendor", color: "yellow" },
  { key: "pilot", layer: "base", name: "Pilot", color: "green" },
];

// Project-level custom fields (upstream). The workspace-level fields with
// option colors are Pro: see workspaceCustomFields.
export const customFields = [
  {
    key: "ticket",
    layer: "base",
    scope: "project",
    project: "firmware",
    name: "Ticket",
    type: "text",
  },
  {
    key: "siteZone",
    layer: "base",
    scope: "project",
    project: "pilot",
    name: "Site zone",
    type: "dropdown",
    options: ["Zone A", "Zone B", "Zone C"],
  },
];

export const tasks = [
  // --- Warehouse Robot v2 -------------------------------------------------
  {
    key: "requirements",
    layer: "base",
    project: "warehouseRobot",
    title: "Requirements & safety concept",
    description: "Collect the safety and performance requirements for v2.",
    status: "done",
    priority: "high",
    start: at(0, 4),
    due: at(1, 5),
    assignee: "claire",
    labels: ["safety"],
  },
  {
    key: "mechanical",
    layer: "base",
    project: "warehouseRobot",
    title: "Mechanical design - chassis",
    description: "Chassis frame, drive mounts and battery bay.",
    status: "in-progress",
    priority: "high",
    start: at(2, 1),
    due: at(4, 5),
    assignee: "marcus",
    labels: ["hardware"],
  },
  {
    key: "electrical",
    layer: "base",
    project: "warehouseRobot",
    title: "Electrical design & wiring harness",
    description: "Power distribution, e-stop circuit and wiring harness.",
    status: "in-progress",
    priority: "medium",
    start: at(2, 3),
    due: at(4, 4),
    assignee: "aisha",
    labels: ["hardware"],
  },
  {
    key: "freezeReview",
    layer: "base",
    project: "warehouseRobot",
    title: "Design freeze review",
    description: "Sign-off gate before production tooling is released.",
    status: "in-review",
    priority: "urgent",
    start: at(5, 1),
    due: at(5, 2),
    assignee: "claire",
    labels: ["safety"],
  },
  {
    key: "prototypeBuild",
    layer: "base",
    project: "warehouseRobot",
    title: "Prototype chassis build",
    description: "Machine and assemble the first prototype chassis.",
    status: "to-do",
    priority: "high",
    start: at(5, 3),
    due: at(7, 3),
    assignee: "marcus",
    labels: ["hardware"],
  },
  {
    key: "prototypeReady",
    layer: "base",
    project: "warehouseRobot",
    title: "Prototype ready",
    description: "The prototype is complete and handed over to integration.",
    status: "to-do",
    priority: "high",
    start: at(7, 4),
    due: at(7, 4),
  },
  {
    key: "battery",
    layer: "base",
    project: "warehouseRobot",
    title: "Battery pack procurement",
    description: "Order and qualify the battery cells and the pack housing.",
    status: "to-do",
    priority: "medium",
    start: at(2, 2),
    due: at(5, 5),
    assignee: "aisha",
    labels: ["vendor"],
  },
  {
    key: "integration",
    layer: "base",
    project: "warehouseRobot",
    title: "Drive & navigation integration",
    description: "Bring up the drives and the navigation stack on the robot.",
    status: "to-do",
    priority: "medium",
    start: at(7, 5),
    due: at(10, 4),
    labels: ["software"],
  },
  {
    key: "motorBringup",
    layer: "base",
    project: "warehouseRobot",
    title: "Motor controller bring-up",
    description: "Run the motor controllers with the new firmware.",
    status: "to-do",
    priority: "high",
    start: at(7, 5),
    due: at(9, 2),
    assignee: "marcus",
    labels: ["software", "hardware"],
  },
  {
    key: "lidar",
    layer: "base",
    project: "warehouseRobot",
    title: "Lidar driver integration",
    description: "Integrate the lidar driver and calibrate the mounting.",
    status: "to-do",
    priority: "medium",
    start: at(7, 5),
    due: at(9, 4),
    assignee: "tom",
    labels: ["software"],
  },
  {
    key: "slam",
    layer: "base",
    project: "warehouseRobot",
    title: "SLAM tuning",
    description: "Tune mapping and localisation for the pilot warehouse.",
    status: "to-do",
    priority: "medium",
    start: at(9, 5),
    due: at(10, 4),
    assignee: "aisha",
    labels: ["software"],
  },
  {
    key: "labTest",
    layer: "base",
    project: "warehouseRobot",
    title: "Lab integration test",
    description: "End-to-end test of the robot on the lab test rig.",
    status: "to-do",
    priority: "high",
    start: at(10, 5),
    due: at(11, 4),
    assignee: "claire",
    labels: ["safety"],
  },
  {
    key: "dryRun",
    layer: "base",
    project: "warehouseRobot",
    title: "Safety certification dry-run",
    description:
      "Dry-run of the safety certification with an external auditor.",
    status: "to-do",
    priority: "high",
    start: at(11, 1),
    due: at(12, 1),
    assignee: "claire",
    labels: ["safety"],
  },
  {
    key: "pilotReadiness",
    layer: "base",
    project: "warehouseRobot",
    title: "Pilot readiness",
    description: "The robot is ready to be shipped to the pilot site.",
    status: "to-do",
    priority: "urgent",
    start: at(12, 2),
    due: at(12, 2),
  },
  // --- Firmware Platform --------------------------------------------------
  {
    key: "bootloader",
    layer: "base",
    project: "firmware",
    title: "Bootloader & OTA update",
    description: "Secure bootloader with over-the-air updates.",
    status: "done",
    priority: "medium",
    start: at(1, 1),
    due: at(2, 5),
    assignee: "tom",
    labels: ["software"],
  },
  {
    key: "motorFirmware",
    layer: "base",
    project: "firmware",
    title: "Motor controller firmware",
    description: "Field-oriented control for the drive motors.",
    status: "in-progress",
    priority: "high",
    start: at(3, 1),
    due: at(7, 4),
    assignee: "tom",
    labels: ["software"],
    fields: { ticket: "FW-1042" },
  },
  {
    key: "canBus",
    layer: "base",
    project: "firmware",
    title: "CAN bus protocol v2",
    description: "Second version of the CAN protocol between the controllers.",
    status: "in-progress",
    priority: "medium",
    start: at(2, 1),
    due: at(5, 5),
    assignee: "marcus",
    labels: ["software"],
    fields: { ticket: "FW-1017" },
  },
  {
    key: "telemetry",
    layer: "base",
    project: "firmware",
    title: "Diagnostics telemetry",
    description: "Stream diagnostics from the robot to the fleet dashboard.",
    status: "blocked",
    priority: "low",
    start: at(6, 1),
    due: at(8, 5),
    assignee: "aisha",
    labels: ["software"],
  },
  {
    key: "releaseCandidate",
    layer: "base",
    project: "firmware",
    title: "Release candidate & regression",
    description: "Freeze the release candidate and run the regression suite.",
    status: "to-do",
    priority: "medium",
    start: at(7, 1),
    due: at(7, 4),
    assignee: "tom",
    labels: ["software"],
    fields: { ticket: "FW-1058" },
  },
  {
    key: "otaTooling",
    layer: "base",
    project: "firmware",
    title: "Fleet OTA rollout tooling",
    description: "Tooling to roll firmware out to a whole fleet.",
    status: "to-do",
    priority: "low",
    start: at(9, 1),
    due: at(11, 5),
    assignee: "tom",
    labels: ["software"],
  },
  // --- Pilot Rollout ------------------------------------------------------
  {
    key: "selectWarehouse",
    layer: "base",
    project: "pilot",
    title: "Select pilot warehouse",
    description: "Choose the warehouse for the first pilot.",
    status: "done",
    priority: "medium",
    start: at(1, 1),
    due: at(2, 5),
    assignee: "claire",
    labels: ["pilot"],
    fields: { siteZone: "Zone C" },
  },
  {
    key: "siteSurvey",
    layer: "base",
    project: "pilot",
    title: "Site survey & floor marking",
    description: "Survey the floor and mark the robot lanes.",
    status: "in-progress",
    priority: "medium",
    start: at(3, 1),
    due: at(5, 5),
    assignee: "aisha",
    labels: ["pilot"],
    fields: { siteZone: "Zone A" },
  },
  {
    key: "trainingPlan",
    layer: "base",
    project: "pilot",
    title: "Operator training plan",
    description: "Training plan for the warehouse operators.",
    status: "to-do",
    priority: "medium",
    start: at(8, 1),
    due: at(9, 5),
    assignee: "aisha",
    labels: ["pilot"],
    fields: { siteZone: "Zone B" },
  },
  {
    key: "reviewCadence",
    layer: "base",
    project: "pilot",
    title: "Weekly pilot review cadence",
    description: "A weekly review with the pilot customer.",
    status: "to-do",
    priority: "medium",
    start: at(10, 1),
    due: at(11, 5),
    assignee: "claire",
    labels: ["pilot"],
    fields: { siteZone: "Zone A" },
  },
  {
    key: "goLive",
    layer: "base",
    project: "pilot",
    title: "Pilot go-live",
    description: "The first robots start working in the pilot warehouse.",
    status: "to-do",
    priority: "urgent",
    start: at(12, 3),
    due: at(12, 3),
    labels: ["pilot"],
  },
];

// Relations as upstream has them: blocks, subtask (source = parent) and
// related. Dependency type and lag are Pro: see dependencies.
export const relations = [
  { layer: "base", from: "requirements", to: "mechanical", type: "blocks" },
  { layer: "base", from: "mechanical", to: "electrical", type: "blocks" },
  { layer: "base", from: "requirements", to: "battery", type: "blocks" },
  { layer: "base", from: "mechanical", to: "freezeReview", type: "blocks" },
  { layer: "base", from: "electrical", to: "freezeReview", type: "blocks" },
  { layer: "base", from: "freezeReview", to: "prototypeBuild", type: "blocks" },
  { layer: "base", from: "battery", to: "prototypeBuild", type: "blocks" },
  {
    layer: "base",
    from: "prototypeBuild",
    to: "prototypeReady",
    type: "blocks",
  },
  { layer: "base", from: "prototypeReady", to: "motorBringup", type: "blocks" },
  { layer: "base", from: "prototypeReady", to: "lidar", type: "blocks" },
  { layer: "base", from: "lidar", to: "slam", type: "blocks" },
  { layer: "base", from: "motorBringup", to: "slam", type: "blocks" },
  { layer: "base", from: "slam", to: "labTest", type: "blocks" },
  { layer: "base", from: "labTest", to: "dryRun", type: "blocks" },
  { layer: "base", from: "dryRun", to: "pilotReadiness", type: "blocks" },
  { layer: "base", from: "labTest", to: "pilotReadiness", type: "blocks" },
  // Across projects: Firmware Platform -> Warehouse Robot v2 -> Pilot Rollout.
  { layer: "base", from: "motorFirmware", to: "motorBringup", type: "blocks" },
  { layer: "base", from: "pilotReadiness", to: "goLive", type: "blocks" },
  {
    layer: "base",
    from: "releaseCandidate",
    to: "trainingPlan",
    type: "blocks",
  },
  // Inside Firmware Platform and Pilot Rollout.
  { layer: "base", from: "bootloader", to: "motorFirmware", type: "blocks" },
  { layer: "base", from: "canBus", to: "telemetry", type: "blocks" },
  {
    layer: "base",
    from: "motorFirmware",
    to: "releaseCandidate",
    type: "blocks",
  },
  { layer: "base", from: "telemetry", to: "otaTooling", type: "blocks" },
  { layer: "base", from: "canBus", to: "motorFirmware", type: "related" },
  { layer: "base", from: "selectWarehouse", to: "siteSurvey", type: "blocks" },
  { layer: "base", from: "siteSurvey", to: "trainingPlan", type: "blocks" },
  { layer: "base", from: "trainingPlan", to: "reviewCadence", type: "blocks" },
  { layer: "base", from: "reviewCadence", to: "goLive", type: "blocks" },
  // Subtasks of the summary task.
  { layer: "base", from: "integration", to: "motorBringup", type: "subtask" },
  { layer: "base", from: "integration", to: "lidar", type: "subtask" },
  { layer: "base", from: "integration", to: "slam", type: "subtask" },
];

// Time logged by the acting user. `day` is an offset from the anchor.
export const timeEntries = [
  {
    key: "chassisSession1",
    layer: "base",
    task: "mechanical",
    by: "marcus",
    start: { day: -4, time: "09:00" },
    end: { day: -4, time: "12:30" },
    description: "Chassis frame layout",
  },
  {
    key: "chassisSession2",
    layer: "base",
    task: "mechanical",
    by: "marcus",
    start: { day: -3, time: "13:00" },
    end: { day: -3, time: "16:00" },
    description: "Battery bay and mounts",
  },
  {
    key: "bootloaderSession",
    layer: "base",
    task: "bootloader",
    by: "claire",
    start: { day: -2, time: "10:00" },
    end: { day: -2, time: "11:00" },
    description: "Review of the update flow",
  },
];

export const externalLinks = [
  {
    key: "chassisDrawings",
    layer: "base",
    task: "mechanical",
    url: "https://example.com/drawings/chassis-v2",
    title: "Chassis drawings",
  },
  {
    key: "firmwareTicket",
    layer: "base",
    task: "motorFirmware",
    url: "https://example.com/tickets/FW-1042",
    title: "Ticket FW-1042",
  },
];

// A calendar feed of the project's tasks that carry the given labels.
export const calendarFeeds = [
  {
    key: "safetyFeed",
    layer: "base",
    project: "warehouseRobot",
    labels: ["safety"],
  },
];

// ---------------------------------------------------------------------------
// Pro layer
// ---------------------------------------------------------------------------

// Project memberships with project roles. They come before the tasks because
// Kaneo Pro only lets project members be assigned.
export const projectMembers = [
  { layer: "pro", project: "warehouseRobot", user: "aisha", role: "member" },
  { layer: "pro", project: "warehouseRobot", user: "tom", role: "member" },
  { layer: "pro", project: "firmware", user: "aisha", role: "member" },
  { layer: "pro", project: "firmware", user: "tom", role: "admin" },
  { layer: "pro", project: "pilot", user: "aisha", role: "admin" },
  { layer: "pro", project: "pilot", user: "tom", role: "member" },
];

// People invited to a project by e-mail who have not joined yet.
export const projectInvitations = [
  {
    key: "leo",
    layer: "pro",
    project: "pilot",
    email: "leo.martins@example.com",
    workspaceRole: "viewer",
    projectRole: "viewer",
  },
];

// Working calendar: weekdays (1 = Monday ... 7 = Sunday) and neutral company
// days. No national holidays: the demo must not depend on a country.
export const calendar = {
  layer: "pro",
  workingDays: [1, 2, 3, 4, 5],
  holidays: [
    { name: "Northwind company day", day: at(2, 4) },
    { name: "Planning offsite day", day: at(6, 3) },
    { name: "Year-end break", day: at(12, 4) },
    { name: "Year-end break", day: at(12, 5) },
    { name: "Year-end company day", day: at(13, 4) },
  ],
};

// How long the workspace keeps its activity history.
export const activityRetention = { layer: "pro", days: 365 };

// Workspace-level custom fields with option colors.
export const workspaceCustomFields = [
  {
    key: "phase",
    layer: "pro",
    scope: "workspace",
    name: "Phase",
    type: "dropdown",
    options: ["Design", "Build", "Test"],
    optionColors: { Design: "purple", Build: "orange", Test: "teal" },
  },
  {
    key: "risk",
    layer: "pro",
    scope: "workspace",
    name: "Risk",
    type: "dropdown",
    options: ["Low", "Medium", "High"],
    optionColors: { Low: "green", Medium: "yellow", High: "red" },
  },
  {
    key: "budget",
    layer: "pro",
    scope: "workspace",
    name: "Budget (EUR)",
    type: "number",
  },
  {
    key: "customerVisible",
    layer: "pro",
    scope: "workspace",
    name: "Customer-visible",
    type: "boolean",
  },
  {
    key: "targetDate",
    layer: "pro",
    scope: "workspace",
    name: "Target date",
    type: "date",
  },
];

// People, equipment and material that can be assigned to tasks.
export const resources = [
  {
    key: "leo",
    layer: "pro",
    kind: "person",
    name: "Contractor: Leo Martins",
    email: "leo.martins@example.com",
  },
  { key: "cnc", layer: "pro", kind: "equipment", name: "CNC machine" },
  { key: "rig", layer: "pro", kind: "equipment", name: "Lab test rig" },
  {
    key: "cells",
    layer: "pro",
    kind: "material",
    name: "Li-ion battery cells",
  },
];

// Pro attributes of tasks. Every entry extends the base task with the same key.
// - progress (0-100), milestone, constraint and approval are task fields;
// - plan holds the planned dates: a baseline is saved at these dates and the
//   task slips to its current start/due in the activity script;
// - assignees lists ALL assignees (the first one is the base assignee) and
//   resources the assigned resources;
// - fields holds the values of the workspace custom fields.
export const taskPro = [
  {
    task: "requirements",
    layer: "pro",
    progress: 100,
    baseline: true,
    assignees: ["claire", "aisha"],
    fields: { phase: "Design", risk: "Low", budget: 12000 },
  },
  {
    task: "mechanical",
    layer: "pro",
    progress: 85,
    baseline: true,
    plan: { start: at(2, 1), due: at(4, 3) },
    fields: { phase: "Design", risk: "Medium", budget: 38000 },
  },
  {
    task: "battery",
    layer: "pro",
    progress: 60,
    baseline: true,
    assignees: ["aisha"],
    resources: ["leo", "cells"],
    fields: { phase: "Build", risk: "Low", budget: 72000 },
  },
  {
    task: "electrical",
    layer: "pro",
    progress: 70,
    baseline: true,
    plan: { start: at(2, 3), due: at(4, 2) },
    assignees: ["aisha", "marcus"],
    fields: { phase: "Design", risk: "Medium", budget: 26000 },
  },
  {
    task: "freezeReview",
    layer: "pro",
    progress: 30,
    baseline: true,
    plan: { start: at(4, 4), due: at(4, 5) },
    constraint: { type: "finish_no_later_than", day: at(5, 3) },
    approval: {
      status: "pending",
      note: "Needs sign-off from Safety (Claire) before tooling is released.",
    },
    assignees: ["claire", "marcus", "aisha"],
    resources: ["leo"],
    fields: { phase: "Design", risk: "High", budget: 4000 },
  },
  {
    task: "prototypeBuild",
    layer: "pro",
    progress: 15,
    baseline: true,
    plan: { start: at(5, 1), due: at(7, 1) },
    constraint: { type: "start_no_earlier_than", day: at(5, 3) },
    assignees: ["marcus"],
    resources: ["cnc"],
    fields: { phase: "Build", risk: "Medium", budget: 54000 },
  },
  {
    task: "prototypeReady",
    layer: "pro",
    milestone: true,
    baseline: true,
    plan: { start: at(7, 2), due: at(7, 2) },
    fields: { phase: "Build" },
  },
  {
    task: "integration",
    layer: "pro",
    plan: { start: at(7, 3), due: at(10, 2) },
    fields: { phase: "Test", risk: "Medium" },
  },
  {
    task: "motorBringup",
    layer: "pro",
    progress: 20,
    baseline: true,
    plan: { start: at(7, 3), due: at(8, 5) },
    assignees: ["marcus", "tom"],
    fields: { phase: "Build", risk: "High", budget: 18000 },
  },
  {
    task: "lidar",
    layer: "pro",
    progress: 10,
    baseline: true,
    plan: { start: at(7, 3), due: at(9, 2) },
    fields: { phase: "Build", risk: "Medium", budget: 15000 },
  },
  {
    task: "slam",
    layer: "pro",
    baseline: true,
    plan: { start: at(9, 3), due: at(10, 2) },
    assignees: ["aisha", "tom"],
    fields: { phase: "Test", risk: "Medium" },
  },
  {
    task: "labTest",
    layer: "pro",
    baseline: true,
    plan: { start: at(10, 3), due: at(11, 2) },
    assignees: ["claire", "tom"],
    resources: ["rig"],
    fields: { phase: "Test", risk: "Medium" },
  },
  {
    task: "dryRun",
    layer: "pro",
    baseline: true,
    plan: { start: at(10, 4), due: at(11, 4) },
    constraint: { type: "finish_no_later_than", day: at(12, 2) },
    assignees: ["claire"],
    resources: ["leo"],
    fields: { phase: "Test", risk: "High" },
  },
  {
    task: "pilotReadiness",
    layer: "pro",
    milestone: true,
    baseline: true,
    plan: { start: at(11, 3), due: at(11, 3) },
    fields: { phase: "Test" },
  },
  {
    task: "bootloader",
    layer: "pro",
    progress: 100,
    fields: { phase: "Build", risk: "Low" },
  },
  {
    task: "motorFirmware",
    layer: "pro",
    progress: 45,
    assignees: ["tom", "marcus"],
    fields: { phase: "Build", risk: "High" },
  },
  {
    task: "canBus",
    layer: "pro",
    progress: 55,
    fields: { phase: "Design", risk: "Medium" },
  },
  {
    task: "telemetry",
    layer: "pro",
    fields: { phase: "Build", risk: "Low" },
  },
  {
    task: "releaseCandidate",
    layer: "pro",
    assignees: ["tom", "aisha"],
    fields: { phase: "Test", risk: "Medium" },
  },
  {
    task: "otaTooling",
    layer: "pro",
    fields: { phase: "Build", risk: "Low" },
  },
  {
    task: "selectWarehouse",
    layer: "pro",
    progress: 100,
    fields: { phase: "Design" },
  },
  {
    task: "siteSurvey",
    layer: "pro",
    progress: 40,
    assignees: ["aisha"],
    resources: ["leo"],
  },
  { task: "trainingPlan", layer: "pro" },
  {
    task: "reviewCadence",
    layer: "pro",
    assignees: ["claire", "aisha"],
  },
  {
    task: "goLive",
    layer: "pro",
    milestone: true,
    plan: { start: at(12, 1), due: at(12, 1) },
  },
];

// Dependency type and lag (in days) of blocks relations. A relation that is not
// listed here keeps the default: finish-to-start with no lag.
export const dependencies = [
  { layer: "pro", from: "mechanical", to: "electrical", type: "ss", lag: 2 },
  { layer: "pro", from: "requirements", to: "battery", type: "fs", lag: 2 },
  { layer: "pro", from: "battery", to: "prototypeBuild", type: "ff", lag: 3 },
  { layer: "pro", from: "labTest", to: "dryRun", type: "ff", lag: 2 },
  {
    layer: "pro",
    from: "motorFirmware",
    to: "releaseCandidate",
    type: "ss",
    lag: 5,
  },
  { layer: "pro", from: "telemetry", to: "otaTooling", type: "ss", lag: 0 },
];

// ---------------------------------------------------------------------------
// Activity script: what happens in the demo workspace, in this order, after
// the data exists. The base steps run first, then the Pro steps.
//   comment  - `by` comments on `task`
//   status   - `by` moves `task` to `status`
//   priority - `by` sets the priority of `task`
//   slip     - (Pro) `by` moves `task` from its planned dates to its current
//              start/due dates, which the baseline then shows as a slip
// ---------------------------------------------------------------------------

export const activity = [
  // Base.
  {
    layer: "base",
    type: "comment",
    by: "marcus",
    task: "mechanical",
    text: "Chassis weld drawings are out for review. Two tolerances are still open.",
  },
  {
    layer: "base",
    type: "comment",
    by: "marcus",
    task: "freezeReview",
    text: "The wiring harness BOM is final. Waiting for the safety checklist.",
  },
  {
    layer: "base",
    type: "comment",
    by: "claire",
    task: "freezeReview",
    text: "I will sign off once the e-stop test report is attached.",
  },
  {
    layer: "base",
    type: "status",
    by: "marcus",
    task: "motorBringup",
    status: "in-progress",
  },
  {
    layer: "base",
    type: "status",
    by: "marcus",
    task: "prototypeBuild",
    status: "in-progress",
  },
  {
    layer: "base",
    type: "status",
    by: "claire",
    task: "battery",
    status: "in-progress",
  },
  {
    layer: "base",
    type: "status",
    by: "marcus",
    task: "lidar",
    status: "in-progress",
  },
  {
    layer: "base",
    type: "priority",
    by: "claire",
    task: "dryRun",
    priority: "urgent",
  },
  // Pro.
  { layer: "pro", type: "slip", by: "marcus", task: "mechanical" },
  { layer: "pro", type: "slip", by: "aisha", task: "electrical" },
  { layer: "pro", type: "slip", by: "claire", task: "freezeReview" },
  { layer: "pro", type: "slip", by: "marcus", task: "prototypeBuild" },
  { layer: "pro", type: "slip", by: "marcus", task: "prototypeReady" },
  { layer: "pro", type: "slip", by: "tom", task: "motorBringup" },
  { layer: "pro", type: "slip", by: "tom", task: "lidar" },
  {
    layer: "pro",
    type: "comment",
    by: "marcus",
    task: "prototypeBuild",
    text: "Prototype build moves by two working days: the CNC machine slot is booked from then on.",
  },
  { layer: "pro", type: "slip", by: "aisha", task: "slam" },
  { layer: "pro", type: "slip", by: "claire", task: "labTest" },
  { layer: "pro", type: "slip", by: "claire", task: "dryRun" },
  {
    layer: "pro",
    type: "comment",
    by: "claire",
    task: "dryRun",
    text: "The dry-run now ends two days after the lab test (finish-to-finish). Pilot readiness moves with it.",
  },
  { layer: "pro", type: "slip", by: "claire", task: "pilotReadiness" },
  { layer: "pro", type: "slip", by: "claire", task: "goLive" },
  { layer: "pro", type: "slip", by: "claire", task: "integration" },
];

// Text typed into the "Add people" dialog by the screenshot script. It is not
// an account and is never created.
export const captureExamples = { addPeopleEmail: "sam.taylor@example.com" };

// Entities that exist once.
export const SINGLE_ENTITIES = { COMPANY, calendar, activityRetention };

// Every collection of entities by name, for scripts and tests that walk them.
export const COLLECTIONS = {
  users,
  workspaceInvitations,
  projects,
  columns,
  labels,
  customFields,
  tasks,
  relations,
  timeEntries,
  externalLinks,
  calendarFeeds,
  activity,
  projectMembers,
  projectInvitations,
  workspaceCustomFields,
  resources,
  taskPro,
  dependencies,
};

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function toIsoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// The Monday (UTC) of the week that contains `now`, as YYYY-MM-DD.
export function defaultAnchor(now = new Date()) {
  const today = utcDay(now);
  const weekday = new Date(today).getUTCDay(); // 0 = Sunday
  const sinceMonday = (weekday + 6) % 7;
  return toIsoDay(today - sinceMonday * DAY_MS);
}

// Validates a YYYY-MM-DD anchor. It must be a Monday: the offsets in this file
// are weeks and weekdays counted from it.
export function parseAnchor(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    throw new Error(`Invalid anchor "${value}": expected YYYY-MM-DD`);
  }
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(ms) || toIsoDay(ms) !== value) {
    throw new Error(`Invalid anchor "${value}": not a calendar date`);
  }
  if (new Date(ms).getUTCDay() !== 1) {
    throw new Error(`Invalid anchor "${value}": it must be a Monday`);
  }
  return ms;
}

// The ISO date (YYYY-MM-DD) `offset` days after the anchor.
export function resolveOffset(anchor, offset) {
  return toIsoDay(parseAnchor(anchor) + offset * DAY_MS);
}

// A timestamp (ISO 8601, UTC) at `time` (HH:MM) on the day `offset` days after
// the anchor.
export function resolveTimestamp(anchor, { day, time }) {
  return `${resolveOffset(anchor, day)}T${time}:00.000Z`;
}

// All dates of the dataset for one anchor, as YYYY-MM-DD strings:
// - tasks[key]: start, due, and (Pro) planStart, planDue, constraintDate;
// - holidays: [{ name, date }].
export function resolveDates(anchor = defaultAnchor()) {
  const proByTask = new Map(taskPro.map((entry) => [entry.task, entry]));
  const resolved = { anchor, tasks: {}, holidays: [] };
  for (const task of tasks) {
    const pro = proByTask.get(task.key);
    resolved.tasks[task.key] = {
      start: resolveOffset(anchor, task.start),
      due: resolveOffset(anchor, task.due),
      planStart: resolveOffset(anchor, pro?.plan?.start ?? task.start),
      planDue: resolveOffset(anchor, pro?.plan?.due ?? task.due),
      constraintDate: pro?.constraint
        ? resolveOffset(anchor, pro.constraint.day)
        : null,
    };
  }
  for (const holiday of calendar.holidays) {
    resolved.holidays.push({
      name: holiday.name,
      date: resolveOffset(anchor, holiday.day),
    });
  }
  return resolved;
}
