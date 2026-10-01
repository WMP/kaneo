#!/usr/bin/env node
// Captures the README screenshots (and optionally a video per scene) of a
// running Kaneo instance that was seeded with seed.mjs.
//
//   node scripts/demo/seed.mjs --out ids.json
//   node scripts/demo/capture.mjs --ids ids.json [--only 01,05] [--video dir]
//
// Every screenshot is 1440 CSS px wide at 2x (2880 px), in the dark theme,
// cropped to its content, and optimised with sharp. The README screenshots are
// taken through a public hostname: see public-host.mjs and README.md.

import { mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import sharp from "sharp";
import * as demo from "./data.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT = resolve(HERE, "../../docs/images/kaneo-pro");
export const DEFAULT_WEB_URL = "http://localhost:5173";

const WIDTH = 1440;
const SCALE = 2;
const POLISH_LETTERS =
  /[\u0105\u0107\u0119\u0142\u0144\u00f3\u015b\u017a\u017c\u0104\u0106\u0118\u0141\u0143\u00d3\u015a\u0179\u017b]/u;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

// Toasts, dev overlays and floating devtools must never show up.
const HIDE_CSS = `
  [data-sonner-toaster], [data-sonner-toast],
  [class*="TanStackRouterDevtools"], [class*="tsqd"], #tsqd-parent-container,
  button[aria-label*="TanStack" i], vite-error-overlay { display: none !important; }
  * { caret-color: transparent !important; }
`;

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

const frames = (page, count) =>
  page.evaluate(
    (n) =>
      new Promise((done) => {
        let seen = 0;
        const tick = () => (++seen >= n ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    count,
  );

// Network idle, web fonts loaded, a few frames rendered, and the page cleaned
// of toasts and overlays.
async function ready(page) {
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: HIDE_CSS });
  await page.evaluate(() => document.fonts.ready);
  await frames(page, 3);
}

// Resizes the viewport to `bottom() + pad`, where bottom() is the lowest edge of
// the content (viewport coordinates, measured in a tall viewport first).
async function fitHeight(
  page,
  measure,
  { pad = 32, min = 400, max = 2400, arg } = {},
) {
  const { width } = page.viewportSize();
  await page.setViewportSize({ width, height: max });
  await frames(page, 4);
  const bottom = await page.evaluate(measure, arg);
  const height = Math.min(max, Math.max(min, Math.ceil(bottom + pad)));
  await page.setViewportSize({ width, height });
  await frames(page, 4);
  return height;
}

// Bottom edge of the Gantt or Portfolio rows. (Functions given to
// page.evaluate are serialised: they cannot use variables of this module.)
const chartBottom = () => {
  const scroller = ".min-h-0.flex-1.overflow-auto";
  const chart =
    document.querySelector(`${scroller} > .min-w-max`) ??
    document.querySelector(`${scroller} > *`);
  return chart ? chart.getBoundingClientRect().bottom : 0;
};

// Bottom edge of the content column of a settings page.
const settingsBottom = () =>
  document.querySelector(".max-w-4xl")?.getBoundingClientRect().bottom ?? 0;

// Bottom edge of the element that contains `text`.
const bottomOfText = (text) => {
  const node = [...document.querySelectorAll("*")].find((element) =>
    [...element.childNodes].some(
      (child) => child.nodeType === 3 && child.textContent.includes(text),
    ),
  );
  return node ? node.getBoundingClientRect().bottom : 0;
};

// The Gantt and the Portfolio window is fixed (from a week before the first
// task), so the visible part is moved by scrolling. The timeline's own
// ctrl+wheel zoom is used only to fit the plan into 1440 px; the UI is never
// scaled.
const shortDate = (anchor, offset) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${demo.resolveOffset(anchor, offset)}T00:00:00Z`));

async function timelineGeometry(page, anchor) {
  // Week columns start on Sundays: anchor + 6 and anchor + 13 are two of them.
  const labels = [shortDate(anchor, 6), shortDate(anchor, 13)];
  return page.evaluate((names) => {
    const centre = (text) => {
      const element = [...document.querySelectorAll("*")].find(
        (candidate) =>
          candidate.children.length === 0 &&
          (candidate.textContent || "").trim() === text &&
          candidate.getBoundingClientRect().width > 0,
      );
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return box.left + box.width / 2;
    };
    const first = centre(names[0]);
    const second = centre(names[1]);
    const rail = document.querySelector(".sticky.left-0");
    return {
      pixelsPerDay:
        first !== null && second !== null ? (second - first) / 7 : null,
      rail: rail ? rail.getBoundingClientRect().width : 0,
    };
  }, labels);
}

// Fits [anchor - 1, anchor + 88] into the viewport: day offsets are counted
// from the window start (anchor - 8).
async function fitTimeline(page, anchor, { rightEdge = 1345 } = {}) {
  const startOffset = 7;
  const endOffset = 95;
  let geometry = await timelineGeometry(page, anchor);
  if (geometry.pixelsPerDay === null) {
    throw new Error("Could not measure the timeline: week labels not found");
  }
  const target = (rightEdge - geometry.rail) / (endOffset - startOffset);
  if (geometry.pixelsPerDay > target) {
    // The zoom factor is exp(-deltaY * 0.0015); wheel deltas are halved at 2x.
    const deltaY = (SCALE * Math.log(geometry.pixelsPerDay / target)) / 0.0015;
    await page.mouse.move(900, 500);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, deltaY);
    await page.keyboard.up("Control");
    await frames(page, 4);
    geometry = await timelineGeometry(page, anchor);
  }
  await page.evaluate(
    (left) => {
      const chart = document.querySelector(".min-h-0.flex-1.overflow-auto");
      if (chart) chart.scrollLeft = left;
    },
    Math.round(startOffset * geometry.pixelsPerDay),
  );
  await frames(page, 4);
  // Park the pointer on empty header space so no row is highlighted.
  await page.mouse.move(1000, 8);
  await frames(page, 2);
}

async function zoomOut(page, notches, at = { x: 900, y: 600 }) {
  await page.mouse.move(at.x, at.y);
  for (let notch = 0; notch < notches; notch++) {
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, 100);
    await page.keyboard.up("Control");
    await frames(page, 3);
  }
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

const dashboard = (env, path = "") =>
  `${env.webUrl}/dashboard/workspace/${env.ids.workspace.id}${path}`;
const projectId = (env, key) => env.ids.projects[key].id;
const taskUrl = (env, project, task) =>
  dashboard(
    env,
    `/project/${projectId(env, project)}/task/${env.ids.tasks[task].id}`,
  );
const ganttUrl = (env, project) =>
  dashboard(env, `/project/${projectId(env, project)}/gantt`);

const WRV = "warehouseRobot";
const WRV_NAME = demo.projects.find((project) => project.key === WRV).name;
const WRV_SLUG = demo.projects.find((project) => project.key === WRV).slug;
const taskTitle = (key) => demo.tasks.find((task) => task.key === key).title;

const GANTT_PREFS = {
  ganttTimelineUnit: "week",
  ganttTimelineUnitTouched: true,
  sidebarDefaultOpen: false,
};

// Rows outside the viewport are not rendered: only a tall viewport shows the
// last row.
async function waitForGantt(page, { lastRow = true } = {}) {
  if (lastRow) await page.getByText(taskTitle("goLive")).first().waitFor();
  await page.getByText("FS +2d").first().waitFor();
  await ready(page);
}

// 01: the project Gantt, all rows, with the critical path.
async function gantt(env) {
  const page = await env.page({
    height: 1800,
    prefs: { ...GANTT_PREFS, ganttShowCriticalPath: true },
  });
  await page.goto(ganttUrl(env, WRV));
  await waitForGantt(page);
  await fitHeight(page, chartBottom, { pad: 0, max: 1800 });
  await fitTimeline(page, env.anchor);
  await ready(page);
  await env.snap(page);
}

// 02: dependency types and lags, the editing popover, non-working days.
async function dependencyTypes(env) {
  const page = await env.page({
    height: 800,
    prefs: {
      ganttShowCriticalPath: false,
      ganttTimelineUnit: "day",
      ganttTimelineUnitTouched: true,
      sidebarDefaultOpen: false,
    },
  });
  await page.goto(ganttUrl(env, WRV));
  await waitForGantt(page, { lastRow: false });
  await page
    .locator('input[type="date"]')
    .fill(demo.resolveOffset(env.anchor, 7));
  await ready(page);
  await zoomOut(page, 7);
  await page.getByText("SS +2d").first().click();
  await page.getByText("Dependency type").waitFor();
  await frames(page, 4);
  await env.snap(page);
}

// 03: the Portfolio timeline of all projects.
async function portfolio(env) {
  const page = await env.page({
    height: 1800,
    prefs: { sidebarDefaultOpen: false },
  });
  await page.goto(dashboard(env, "/portfolio"));
  await page.getByText(taskTitle("goLive")).first().waitFor();
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await page.getByText(shortDate(env.anchor, 13), { exact: true }).waitFor();
  await ready(page);
  await fitHeight(page, chartBottom, { pad: 0, max: 1800 });
  await fitTimeline(page, env.anchor);
  await ready(page);
  await env.snap(page);
}

// 04: the workspace workload, flagging more than two concurrent tasks.
async function workload(env) {
  const page = await env.page({ height: 900 });
  await page.goto(dashboard(env, "/workload"));
  await page.getByText("Unassigned").first().waitFor();
  const dates = page.locator('input[type="date"]');
  await dates.nth(0).fill(demo.resolveOffset(env.anchor, 7));
  await dates.nth(1).fill(demo.resolveOffset(env.anchor, 83));
  await page
    .locator("select, [role=combobox]")
    .filter({ hasText: /Highlight above/ })
    .first()
    .click();
  await page.getByText("Highlight above 2", { exact: true }).click();
  await page.mouse.click(1200, 700);
  await ready(page);
  await fitHeight(page, bottomOfText, {
    arg: "concurrent tasks",
    pad: 56,
    min: 500,
  });
  await env.snap(page);
}

// 05: the workspace activity, filtered to one project.
async function activity(env) {
  const entries = 7; // the newest entries are shown completely
  const page = await env.page({ height: 1800 });
  await page.goto(dashboard(env, "/activity"));
  await page.locator("select").nth(2).waitFor();
  await page.locator("select").nth(2).selectOption({ label: WRV_NAME });
  await page.getByText("updated the plan").first().waitFor();
  await ready(page);
  const tops = await page.evaluate((slug) => {
    const pattern = new RegExp(`^${slug}-\\d+`);
    const found = [...document.querySelectorAll("*")]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return (
          pattern.test((element.textContent || "").trim()) &&
          box.height > 8 &&
          box.height < 30 &&
          element.children.length <= 4
        );
      })
      .map((element) => Math.round(element.getBoundingClientRect().top))
      .sort((a, b) => a - b);
    const unique = [];
    for (const top of found) {
      if (unique.length === 0 || top - unique[unique.length - 1] > 20) {
        unique.push(top);
      }
    }
    return unique;
  }, WRV_SLUG);
  if (tops.length <= entries) {
    throw new Error(`The activity feed has only ${tops.length} entries`);
  }
  await page.setViewportSize({ width: WIDTH, height: tops[entries] + 6 });
  await frames(page, 4);
  await page.mouse.move(1000, 8);
  await env.snap(page);
}

// 06: the working calendar (working days and holidays) in the workspace settings.
async function calendar(env) {
  const page = await env.page({ height: 2400 });
  await page.goto(`${env.webUrl}/dashboard/settings/workspace/general`);
  await page.getByText("Working calendar", { exact: true }).first().waitFor();
  await page.getByText(demo.calendar.holidays[0].name).first().waitFor();
  await ready(page);
  const geometry = await page.evaluate(() => {
    const leaf = (text) =>
      [...document.querySelectorAll("*")].find(
        (element) =>
          element.children.length === 0 &&
          (element.textContent || "").trim() === text,
      );
    const holidays = leaf("Holidays");
    const card =
      holidays.closest("[class*='border']") ?? holidays.parentElement;
    const scroller = document.querySelector(".flex-1.min-w-0.overflow-y-auto");
    return {
      headingTop: leaf("Working calendar").getBoundingClientRect().top,
      cardBottom: card.getBoundingClientRect().bottom,
      scrollerTop: scroller.getBoundingClientRect().top,
    };
  });
  const height = Math.ceil(
    geometry.scrollerTop + (geometry.cardBottom - geometry.headingTop) + 56,
  );
  await page.setViewportSize({ width: WIDTH, height });
  await frames(page, 4);
  await page.evaluate(() => {
    const leaf = [...document.querySelectorAll("*")].find(
      (element) =>
        element.children.length === 0 &&
        (element.textContent || "").trim() === "Working calendar",
    );
    const scroller = document.querySelector(".flex-1.min-w-0.overflow-y-auto");
    scroller.scrollTop +=
      leaf.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  });
  await frames(page, 4);
  await env.snap(page);
}

// 07: the Gantt coloured by the workspace custom field "Phase".
async function customFieldGantt(env) {
  const page = await env.page({
    height: 2200,
    prefs: {
      ...GANTT_PREFS,
      ganttShowCriticalPath: false,
      ganttCustomFieldByProject: {
        [projectId(env, WRV)]: env.ids.customFields.phase.id,
      },
      ganttBarColorSourceByProject: { [projectId(env, WRV)]: "customField" },
    },
  });
  await page.goto(ganttUrl(env, WRV));
  await waitForGantt(page);
  await page.getByText("Phase: Design").first().waitFor();
  // Collapse the summary task so that every remaining row fits (~1330 px).
  await page.getByRole("button", { name: "Collapse subtasks" }).first().click();
  await frames(page, 4);
  await fitHeight(page, chartBottom, { pad: 0, max: 2200 });
  await fitTimeline(page, env.anchor);
  await ready(page);
  await env.snap(page);
}

// 07b: the workspace custom field settings, with the inline edit form of the
// "Phase" field open (name, options, default value, required). Nothing is saved.
async function customFieldSettings(env) {
  const page = await env.page({ height: 900 });
  await page.goto(`${env.webUrl}/dashboard/settings/workspace/custom-fields`);
  await page.getByText("Customer-visible").first().waitFor();
  await ready(page);
  const phaseId = env.ids.customFields.phase.id;
  await page.locator(`#custom-field-edit-button-${phaseId}`).click();
  await page.locator(`#custom-field-edit-${phaseId}-name`).waitFor();
  await frames(page, 4);
  await fitHeight(page, settingsBottom, { pad: 48, min: 500 });
  await env.snap(page);
}

// 08: a task with an approval gate, progress, baseline and a date constraint.
async function taskDetail(env) {
  const page = await env.page({ height: 900 });
  await page.goto(taskUrl(env, WRV, "freezeReview"));
  await page
    .getByText("Finish no later than", { exact: true })
    .locator("visible=true")
    .first()
    .waitFor();
  await ready(page);
  await page
    .getByRole("button", { name: /Pending approval/ })
    .first()
    .click();
  await page.getByRole("button", { name: "No approval needed" }).waitFor();
  await frames(page, 4);
  await env.snap(page);
}

// 08c: the assignee picker of a task with several assignees and a resource. The
// trigger lists everybody, and the person resource without an account has an
// invite button (the picker offers it to somebody who may invite).
async function taskAssignees(env) {
  const page = await env.page({ height: 900 });
  await page.goto(taskUrl(env, WRV, "freezeReview"));
  await page
    .getByText("Finish no later than", { exact: true })
    .locator("visible=true")
    .first()
    .waitFor();
  await ready(page);
  await page
    .getByRole("button", { name: /\d+ assigned/ })
    .first()
    .click();
  await page.getByText("Unassign all").waitFor();
  // Point at the invite button of the person resource, so that its hover
  // background marks it.
  const invite = page
    .getByRole("button", { name: "Invite to project" })
    .first();
  await invite.hover();
  await frames(page, 4);
  // From the top of the page to a little below the picker.
  const bottom = await page.evaluate(() => {
    const popup = document.querySelector("[data-slot='popover-popup']");
    return popup ? popup.getBoundingClientRect().bottom : 0;
  });
  const { height } = page.viewportSize();
  await env.snap(page, {
    clip: {
      x: WIDTH - 560,
      y: 0,
      width: 560,
      height: Math.min(height, Math.ceil(bottom + 32)),
    },
  });
}

// 09: people, equipment and material in the workspace settings.
async function resources(env) {
  const page = await env.page({ height: 900 });
  await page.goto(`${env.webUrl}/dashboard/settings/workspace/resources`);
  await page.getByText("CNC machine").first().waitFor();
  await ready(page);
  await fitHeight(page, settingsBottom, { pad: 48, min: 500 });
  await env.snap(page);
}

// 10: project members with project roles, and a pending invitation.
async function members(env) {
  const page = await env.page({ height: 900 });
  await page.goto(
    `${env.webUrl}/dashboard/settings/projects/${projectId(env, "pilot")}/members`,
  );
  await page.getByText(demo.projectInvitations[0].email).first().waitFor();
  await ready(page);
  await fitHeight(page, settingsBottom, { pad: 48, min: 500 });
  await env.snap(page);
}

// 10b: the "Add people" dialog with an e-mail address typed in.
async function addPeople(env) {
  const page = await env.page({ height: 900 });
  await page.goto(
    `${env.webUrl}/dashboard/settings/projects/${projectId(env, "pilot")}/members`,
  );
  await page.getByText(demo.projectInvitations[0].email).first().waitFor();
  await ready(page);
  await fitHeight(page, settingsBottom, { pad: 48, min: 500 });
  await page.getByRole("button", { name: /Add people/ }).click();
  const email = demo.captureExamples.addPeopleEmail;
  await page.getByPlaceholder(/Search by name or email/).fill(email);
  await page.getByText(`Send invitation to ${email}`).waitFor();
  await frames(page, 4);
  const dialog = await page.evaluate(() => {
    const boxes = [
      ...document.querySelectorAll("[role='dialog'],[data-slot*='dialog']"),
    ]
      .map((element) => element.getBoundingClientRect())
      .filter((box) => box.width > 300 && box.width < 900 && box.height > 200);
    boxes.sort((a, b) => b.width * b.height - a.width * a.height);
    return {
      x: boxes[0].x,
      y: boxes[0].y,
      w: boxes[0].width,
      h: boxes[0].height,
    };
  });
  const view = page.viewportSize();
  const width = Math.round(dialog.w + 340);
  const height = Math.min(view.height, Math.round(dialog.h + 150));
  await env.snap(page, {
    clip: {
      x: Math.max(0, Math.round(dialog.x + dialog.w / 2 - width / 2)),
      y: Math.max(
        0,
        Math.min(
          view.height - height,
          Math.round(dialog.y + dialog.h / 2 - height / 2),
        ),
      ),
      width,
      height,
    },
  });
}

// 11: the MCP connection page (endpoint and client commands, no secrets).
async function mcp(env) {
  const page = await env.page({ height: 900 });
  await page.goto(`${env.webUrl}/dashboard/settings/account/mcp`);
  await page.getByText("Server URL", { exact: true }).waitFor();
  await ready(page);
  // The page is ~1940 px tall: cut it after the Codex card.
  await fitHeight(
    page,
    () => {
      const heading = [...document.querySelectorAll("*")].find(
        (element) =>
          element.children.length === 0 &&
          (element.textContent || "").trim() === "Codex",
      );
      const card =
        heading.closest("[data-slot=card]") ??
        heading.parentElement.parentElement;
      return card.getBoundingClientRect().bottom;
    },
    { pad: 36, min: 500 },
  );
  await env.snap(page);
}

export const SCENES = [
  { id: "01", file: "01-gantt", run: gantt },
  { id: "02", file: "02-gantt-dependency-types", run: dependencyTypes },
  { id: "03", file: "03-portfolio", run: portfolio },
  { id: "04", file: "04-workload", run: workload },
  { id: "05", file: "05-activity", run: activity },
  { id: "06", file: "06-calendar", run: calendar },
  { id: "07", file: "07-custom-fields", run: customFieldGantt },
  { id: "07b", file: "07b-custom-fields-settings", run: customFieldSettings },
  { id: "08", file: "08-task-detail", run: taskDetail },
  { id: "08c", file: "08c-task-assignees", run: taskAssignees },
  { id: "09", file: "09-resources", run: resources },
  { id: "10", file: "10-project-members", run: members },
  { id: "10b", file: "10b-add-people", run: addPeople },
  { id: "11", file: "11-mcp", run: mcp },
];

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

// Options: webUrl, ids (the parsed --out file of seed.mjs), password, outDir,
// only (scene ids), videoDir, chromium (executable path), launchArgs,
// ignoreHTTPSErrors, forbidLocalhost, log.
export async function captureScreenshots(options) {
  const webUrl = (options.webUrl ?? DEFAULT_WEB_URL).replace(/\/+$/, "");
  const ids = options.ids;
  if (!ids?.workspace?.id) {
    throw new Error("capture needs the ids file written by seed.mjs --out");
  }
  const password =
    options.password ?? process.env.KANEO_DEMO_PASSWORD ?? ids.password;
  if (!password) {
    throw new Error(
      "The demo password is unknown: pass --password or set KANEO_DEMO_PASSWORD",
    );
  }
  const outDir = resolve(options.outDir ?? DEFAULT_OUT);
  const log = options.log ?? (() => {});
  const forbidLocalhost =
    options.forbidLocalhost ?? !LOCAL_HOSTS.has(new URL(webUrl).hostname);
  const only = options.only?.length ? new Set(options.only) : null;
  const scenes = SCENES.filter((scene) => !only || only.has(scene.id));
  for (const id of only ?? []) {
    if (!SCENES.some((scene) => scene.id === id)) {
      throw new Error(
        `Unknown scene "${id}". Scenes: ${SCENES.map((scene) => scene.id).join(", ")}`,
      );
    }
  }
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: options.chromium || undefined,
    args: options.launchArgs ?? [],
  });
  const contextOptions = {
    viewport: { width: WIDTH, height: 900 },
    deviceScaleFactor: SCALE,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "dark",
    ignoreHTTPSErrors: Boolean(options.ignoreHTTPSErrors),
  };
  const results = [];
  try {
    const storageState = await signIn(browser, contextOptions, {
      webUrl,
      email: demo.users[0].email,
      password,
    });
    for (const scene of scenes) {
      log(`scene ${scene.id} ${scene.file}`);
      results.push(
        await runScene(scene, {
          browser,
          contextOptions,
          storageState,
          webUrl,
          ids,
          anchor: ids.anchor,
          outDir,
          videoDir: options.videoDir ? resolve(options.videoDir) : null,
          forbidLocalhost,
          log,
        }),
      );
    }
  } finally {
    await browser.close();
  }
  return results;
}

async function signIn(browser, contextOptions, { webUrl, email, password }) {
  const context = await browser.newContext(contextOptions);
  try {
    const page = await context.newPage();
    await page.goto(`${webUrl}/auth/sign-in`);
    await page.locator('input[type="email"], input[name="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await page.waitForLoadState("networkidle");
    return await context.storageState();
  } finally {
    await context.close();
  }
}

async function runScene(scene, env) {
  const contexts = [];
  const videos = [];
  const seen = { localhost: new Set() };
  const sceneEnv = {
    webUrl: env.webUrl,
    ids: env.ids,
    anchor: env.anchor,
    // Opens a page of the signed-in user. `prefs` overrides entries of the
    // "user-preferences" store (the theme is always dark).
    async page({ height = 900, prefs = {} } = {}) {
      const context = await env.browser.newContext({
        ...env.contextOptions,
        viewport: { width: WIDTH, height },
        storageState: env.storageState,
        ...(env.videoDir
          ? {
              recordVideo: {
                dir: env.videoDir,
                size: { width: WIDTH, height },
              },
            }
          : {}),
      });
      await context.addInitScript((overrides) => {
        try {
          let current = {};
          try {
            current = JSON.parse(
              localStorage.getItem("user-preferences") || "{}",
            );
          } catch {}
          const state = {
            ...(current.state || {}),
            theme: "dark",
            sidebarDefaultOpen: true,
            ...overrides,
          };
          localStorage.setItem(
            "user-preferences",
            JSON.stringify({ state, version: current.version ?? 0 }),
          );
          localStorage.setItem("i18nextLng", "en-US");
        } catch {}
      }, prefs);
      context.on("request", (request) => {
        if (LOCAL_HOSTS.has(new URL(request.url()).hostname)) {
          seen.localhost.add(request.url());
        }
      });
      const page = await context.newPage();
      page.on("websocket", (socket) => {
        if (LOCAL_HOSTS.has(new URL(socket.url()).hostname)) {
          seen.localhost.add(socket.url());
        }
      });
      page.on("pageerror", (error) => {
        env.log(`  page error: ${error.message.slice(0, 160)}`);
      });
      contexts.push(context);
      videos.push(page.video());
      return page;
    },
    async snap(page, { clip } = {}) {
      return snapshot(page, {
        file: join(env.outDir, `${scene.file}.png`),
        clip,
        forbidLocalhost: env.forbidLocalhost,
        seen,
        log: env.log,
      });
    },
  };
  let result;
  try {
    await scene.run(sceneEnv);
    result = { scene: scene.id, file: `${scene.file}.png` };
  } finally {
    if (env.videoDir && contexts.length > 0) {
      // Hold the final state for a moment so that the video ends on it.
      await contexts[0]
        .pages()[0]
        ?.waitForTimeout(1000)
        .catch(() => {});
    }
    for (const context of contexts) await context.close();
    if (env.videoDir && videos[0]) {
      mkdirSync(env.videoDir, { recursive: true });
      const source = await videos[0].path().catch(() => null);
      if (source) renameSync(source, join(env.videoDir, `${scene.file}.webm`));
    }
  }
  return result;
}

async function snapshot(page, { file, clip, forbidLocalhost, seen, log }) {
  if (await page.locator("vite-error-overlay").count()) {
    throw new Error("A Vite error overlay is visible");
  }
  const dark = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  );
  if (!dark) throw new Error("The page is not in the dark theme");
  const text = await page.evaluate(() => document.body.innerText);
  if (POLISH_LETTERS.test(text)) {
    throw new Error(
      `The page shows a Polish letter: ${text.match(POLISH_LETTERS)[0]}`,
    );
  }
  if (forbidLocalhost) {
    if (/localhost|127\.0\.0\.1/i.test(text)) {
      throw new Error("The page shows localhost");
    }
    if (seen.localhost.size > 0) {
      throw new Error(
        `The page talked to localhost (${[...seen.localhost][0]}): start the API with KANEO_CLIENT_URL and the web app with VITE_API_URL set to the public address`,
      );
    }
  }
  const raw = await page.screenshot({ clip, animations: "disabled" });
  await sharp(raw)
    .png({
      palette: true,
      quality: 90,
      colors: 256,
      dither: 0.6,
      compressionLevel: 9,
      effort: 10,
    })
    .toFile(file);
  const meta = await sharp(file).metadata();
  const kb = Math.round(statSync(file).size / 1024);
  log(`  ${file} ${meta.width}x${meta.height} ${kb} KB`);
  return { file, width: meta.width, height: meta.height, kb };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `Capture the README screenshots of a seeded Kaneo instance.

Usage: node scripts/demo/capture.mjs --ids <file> [options]

  --ids <file>        ids written by "seed.mjs --out" (required)
  --web-url <url>     web app (default ${DEFAULT_WEB_URL})
  --out <dir>         output directory (default docs/images/kaneo-pro)
  --only <list>       scene ids, e.g. 01,05 (default: all)
                      ${SCENES.map((scene) => scene.id).join(" ")}
  --video <dir>       also record a webm per scene (not committed)
  --chromium <path>   Chromium executable (or KANEO_DEMO_CHROMIUM), for an
                      installation that Playwright did not download
  --chromium-arg <a>  extra Chromium argument, repeatable
  --password <text>   password of the demo accounts (or KANEO_DEMO_PASSWORD;
                      not needed for a local seed, its ids file has it)
  --ignore-https-errors
  --help
`;

async function main() {
  const { values } = parseArgs({
    options: {
      ids: { type: "string" },
      "web-url": { type: "string" },
      out: { type: "string" },
      only: { type: "string" },
      video: { type: "string" },
      chromium: { type: "string" },
      "chromium-arg": { type: "string", multiple: true },
      password: { type: "string" },
      "ignore-https-errors": { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  if (!values.ids) throw new Error("--ids <file> is required (see --help)");
  const results = await captureScreenshots({
    webUrl: values["web-url"],
    ids: JSON.parse(readFileSync(resolve(values.ids), "utf8")),
    password: values.password,
    outDir: values.out,
    only: values.only?.split(",").map((id) => id.trim()),
    videoDir: values.video,
    chromium: values.chromium ?? process.env.KANEO_DEMO_CHROMIUM,
    launchArgs: values["chromium-arg"],
    ignoreHTTPSErrors: values["ignore-https-errors"],
    log: (line) => console.log(line),
  });
  console.log(`Captured ${results.length} screenshots.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  });
}
