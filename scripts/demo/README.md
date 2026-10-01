# Kaneo demo tool

One fictional dataset, created through the public HTTP API, serves four uses:

1. the screenshots in the root `README.md` (`docs/images/kaneo-pro/`);
2. a public demo instance;
3. end-to-end tests that record videos and screenshots;
4. the check of each upstream merge: seed the upstream-compatible part on plain Kaneo, upgrade to Kaneo Pro, and confirm that nothing was lost (planned, see [Layers](#layers)).

The company is "Northwind Robotics". All people have international names and addresses under `example.com`, a reserved domain that never receives mail. There is no real customer or personal data anywhere in the tool.

The plan behind it is in [`docs/plans/demo-data.md`](../../docs/plans/demo-data.md).

## Safety

**The seed creates accounts with a known password.** Run it only against a local instance or a dedicated demo instance, never against production data or credentials.

- Without `--allow-remote` the seed talks to `localhost` and the loopback addresses only. The built-in password (`DemoPass123!`) works only there.
- For any other address you must pass `--allow-remote` and your own password of at least 12 characters (`--password` or `KANEO_DEMO_PASSWORD`). The built-in one is refused.
- `--reset` deletes one workspace: the one named "Northwind Robotics" that `claire@example.com` owns. It refuses anything else.
- The seed uses only the HTTP API. It never writes SQL and needs no database access.
- The password is written to the `--out` file only for a local seed.

## Files

| File | Purpose |
| --- | --- |
| `data.mjs` | The dataset as plain data, with the layer of every entity, and the date resolver. Dates are offsets from an anchor. |
| `seed.mjs` | CLI and `seedDemo(options)`: creates the dataset through the API and returns the ids of everything it created. |
| `capture.mjs` | CLI and `captureScreenshots(options)`: Playwright scenes that write the README screenshots, optionally with a video per scene. |
| `public-host.mjs` | Rehearses a public deployment on this machine: HTTPS proxy, seed and screenshots through `https://kaneopro.example.com`. |
| `api.mjs` | Small HTTP client (cookie jar, Origin header, retry on rate limits). |
| `upstream-contract.mjs` | The upstream Kaneo v2.29.3 routes and fields that the base layer may use. |
| `package.json`, `package-lock.json` | Standalone npm package (Playwright and sharp, exact versions). It does not touch the pnpm workspace or `pnpm-lock.yaml`. |
| `../ci/demo-data.test.mjs` | Dataset checks that run in CI without network or dependencies. |

## Setup

The seed and the dataset tests need nothing but Node.js (the repository uses 24). The screenshots also need the package dependencies and a Chromium:

```sh
npm --prefix scripts/demo ci
npm --prefix scripts/demo run setup      # downloads the Chromium that Playwright uses
```

If a Chromium is already installed, skip the second command and pass `--chromium <path>` or set `KANEO_DEMO_CHROMIUM`.

## Seed a local instance

Start Kaneo as usual (PostgreSQL running, then `pnpm dev`, or only the two apps with `pnpm --filter @kaneo/api dev` and `pnpm --filter @kaneo/web dev`), then:

```sh
node scripts/demo/seed.mjs --reset --out /tmp/kaneo-demo.json
```

| Option | Meaning |
| --- | --- |
| `--api-url <url>` | API origin. Default `http://localhost:1337`, or `KANEO_DEMO_API_URL`. |
| `--origin <url>` | `Origin` header to send. Set it to the instance's `KANEO_CLIENT_URL` when that is not the API's own origin. |
| `--password <text>` | Password of the demo accounts, or `KANEO_DEMO_PASSWORD`. |
| `--anchor <date>` | The Monday all dates are counted from. Default: the Monday of the current week (UTC). A fixed anchor gives the same layout every time. |
| `--layers <list>` | `base`, `pro` or `base,pro` (default). See [Layers](#layers). |
| `--reset` | Delete the existing demo workspace first. Without it, an existing workspace stops the seed. |
| `--out <file>` | Write the ids of everything created, by key, as JSON. |
| `--allow-remote` | Required when the API is not on localhost. |
| `--quiet` | Print nothing but errors. |

The accounts (password `DemoPass123!` on localhost):

| Person | E-mail | Workspace role |
| --- | --- | --- |
| Claire Donovan | `claire@example.com` | owner |
| Marcus Reyes | `marcus@example.com` | admin |
| Aisha Rahman | `aisha@example.com` | member |
| Tom Becker | `tom@example.com` | viewer |

"Contractor: Leo Martins" (`leo.martins@example.com`) has no account: the entry is a person resource with a pending project invitation. The first account created on an instance becomes its administrator, and the seed creates Claire first.

Then take the screenshots:

```sh
node scripts/demo/capture.mjs --ids /tmp/kaneo-demo.json --out /tmp/kaneo-shots
```

Scenes are `01 02 03 04 05 06 07 07b 08 08c 09 10 10b 11` (file names in `capture.mjs`). Useful options:

| Option | Meaning |
| --- | --- |
| `--web-url <url>` | Web app. Default `http://localhost:5173`. |
| `--out <dir>` | Output directory. Default `docs/images/kaneo-pro`. |
| `--only 01,05` | Only these scenes. |
| `--video <dir>` | Also record one `.webm` per scene. Not committed. |
| `--chromium <path>` | Chromium executable, or `KANEO_DEMO_CHROMIUM`. |

Every screenshot is taken in the dark theme (asserted before each shot), 1440 CSS px wide at 2x, cropped to its content, with toasts and devtools hidden and a palette PNG from sharp. The capture stops with an error instead of saving a wrong picture: light theme, a Vite error overlay or a Polish letter on the page.

## Public hostname rehearsal

The README screenshots must not show `localhost`. The MCP page, for example, builds the server URL from the address of the page and the API address the web app was built with, so it would print `http://localhost:1337/api/mcp`. `public-host.mjs` makes the app reachable as `https://kaneopro.example.com` on this machine, without DNS, a hosts file or root rights:

1. it creates a self-signed certificate for the host with `openssl` (a temporary directory);
2. it starts an HTTPS reverse proxy on `127.0.0.1:8443`: `/api` (with WebSocket upgrades) goes to the API, everything else (with Vite's HMR socket) to the web app;
3. it seeds the demo data, calling the API directly with the public `Origin`;
4. it starts Chromium with `--host-resolver-rules` mapping the host to the proxy (this also changes the port) and `--no-proxy-server`, then captures every scene through `https://kaneopro.example.com`.

Point the app at the public address first. Use these two git-ignored files, because `pnpm dev` (turbo) hands only some variables on to the apps, while the files work however you start it:

```sh
# .env   (API)
KANEO_CLIENT_URL=https://kaneopro.example.com
KANEO_API_URL=https://kaneopro.example.com

# apps/web/.env.development.local   (web app)
VITE_API_URL=https://kaneopro.example.com/api
VITE_CLIENT_URL=https://kaneopro.example.com
```

Do not use `apps/web/.env.local` for the web app: Vite ranks the tracked `apps/web/.env.development` above it, so it would not take effect. Variables exported in the shell do take effect when you start the web app directly.

Restart the API and the web app, then:

```sh
node scripts/demo/public-host.mjs
```

The script checks first that the API trusts the host and the web app was started for it, and tells you what to change if not. The capture refuses to save a screenshot when the page text contains `localhost` or `127.0.0.1`, or when the page sent a request or opened a WebSocket to localhost.

Options: `--host`, `--https-port`, `--api-port`, `--web-port`, `--anchor`, `--only`, `--out`, `--video`, `--chromium`, `--ids-out <file>` (keep the ids), `--no-seed --ids <file>` (capture what is there), `--serve` (keep the proxy running so you can browse `https://kaneopro.example.com` in a Chromium started with the printed flags).

Undo the change afterwards: remove the two variables from `.env`, delete `apps/web/.env.development.local` and restart.

## Regenerating the README screenshots

1. Start the app for the public host as described above, on an empty or disposable database.
2. Run `node scripts/demo/public-host.mjs`. With no `--out` it overwrites the 14 files in `docs/images/kaneo-pro/`.
3. Open every PNG and check it: dark theme, no `localhost`, no real names or secrets, the feature that the README caption names is visible, nothing is cut off. The script prints the size of each file; keep each one under about 700 KB.
4. Commit the PNGs. `scripts/ci/readme.test.mjs` requires that `README.md` references every PNG in the folder and that every referenced file exists: when you add or rename a scene, change `README.md` too.

The dates follow the current week, so the pictures show dates near the day you took them. Pass `--anchor YYYY-MM-DD` (a Monday) for a fixed layout.

To rehearse the public demo instance as well, add its flags (see [A public demo instance](#a-public-demo-instance)) to the same `.env`.

## A public demo instance

Seed an instance that runs on its own address and holds nothing but demo data:

```sh
export KANEO_DEMO_PASSWORD='<at least 12 characters, not the built-in one>'
node scripts/demo/seed.mjs --api-url https://demo.example.org --allow-remote --reset --out ids.json
```

Use `--origin` when the web app has another origin than the API. Seed into a **fresh database**: with `DISABLE_WORKSPACE_CREATION=true` only the instance administrator may create a workspace, and that is the first account ever created, which the seed makes Claire.

Recommended configuration of the demo instance:

| Setting | Why |
| --- | --- |
| `DISABLE_USER_DIRECTORY=true` | The account search would reveal that accounts exist. |
| `DISABLE_WORKSPACE_CREATION=true` | Visitors cannot create workspaces of their own. |
| `DISABLE_GUEST_ACCESS=true` | No anonymous accounts. |
| `DISABLE_REGISTRATION=true` **after** seeding | Registration must be open while the seed runs, because it signs up four accounts. The seed stops with a clear message when sign-up is refused. |
| no SMTP | The demo never sends mail, so an address that a visitor types in cannot receive anything. |

Every change a visitor makes is lost at the next reset. The reset is: drop the database, let the API migrate the empty one, run the seed again. The scheduled job and the visitors' sign-in instructions belong to stage 3 of the plan and are not part of this tool yet. If you publish the password, publish it only for that dedicated instance.

## Layers

Every entity in `data.mjs` has `layer: "base"` or `layer: "pro"`.

- **base**: what upstream Kaneo v2.29.3 supports: accounts, workspace and its built-in roles, a pending workspace invitation, projects, columns, labels, tasks (title, description, status, priority, dates, one assignee), comments, time entries, links, relations (`blocks`, `subtask`, `related`, no type or lag), project custom fields and their values, calendar feeds.
- **pro**: the Kaneo Pro additions: dependency types and lag, progress, milestones, baselines, date constraints, approval gates, the working calendar and holidays, workspace custom fields, several assignees and resources, project memberships and invitations, activity retention.

```sh
node scripts/demo/seed.mjs --layers base --out ids.json       # upstream-compatible data only
node scripts/demo/seed.mjs --layers pro --out ids.json        # adds the Pro data on top
node scripts/demo/seed.mjs --layers base,pro                  # both (the default)
```

- A base step sends only the routes, body fields, query parameters and enum values listed in `upstream-contract.mjs`. Every request of a base step is checked against that list at run time, so a base step that reaches for a Pro route or field fails at once, also on a Pro instance. Each entry names the upstream file it comes from (checked with `git show v2.29.3:<file>`).
- `--layers pro` runs on top of an existing base seed. It finds the base entities by the ids in the `--out` file when it exists, otherwise by name, and adds or updates only Pro data.
- Base and then pro gives the same end state as both at once. (Kaneo Pro only lets project members be assigned, so the seed adds the Pro project memberships before the base tasks and finishes refused assignments in the Pro layer.)
- The `--out` file records the layer that created each id.
- `scripts/ci/demo-data.test.mjs` checks that every entity has a layer and that no base entity uses a Pro-only field.

The base layer was checked against the upstream source, but it has not been run against an upstream instance yet. The upgrade verification that uses the layers (seed base on plain Kaneo, upgrade the same database to Kaneo Pro, check that every base entity is unchanged) is planned for the next pull request: stage 4 of the plan.

Not seeded: project background images (they need S3 storage).

## Using it from end-to-end tests

`seedDemo()` is a plain async function with no side effects besides the API calls, so a Playwright `globalSetup` can call it against a fresh database:

```js
import { seedDemo } from "../scripts/demo/seed.mjs";

export default async function globalSetup() {
  const ids = await seedDemo({
    apiUrl: process.env.KANEO_API_URL ?? "http://localhost:1337",
    reset: true,
    anchor: "2026-09-28", // optional: a fixed layout
  });
  // ids.workspace.id, ids.projects.warehouseRobot.id, ids.tasks.freezeReview.id,
  // ids.users.claire.email ... each entry also has its `layer`.
  process.env.KANEO_DEMO_IDS = JSON.stringify(ids);
}
```

From a shell, `seed.mjs --out ids.json` writes the same object. The password is in it for a local seed (`ids.password`). `data.mjs` exports the dataset (names, e-mail addresses, titles), so a test can assert on the same texts without copying them. `captureScreenshots({ webUrl, ids, outDir, only, videoDir })` is exported from `capture.mjs`; `--video <dir>` (or `videoDir`) records one video per scene.

## The dataset

Three projects: Warehouse Robot v2 (14 tasks, the one most screenshots show), Firmware Platform (6) and Pilot Rollout (5), with subtasks, labels, comments, cross-project dependencies, a baseline that the plan has slipped against, a working calendar with neutral company and year-end days (no national holidays), a workspace custom field "Phase", an approval gate, resources (a contractor, two pieces of equipment, a material) and project roles that differ from the workspace roles.

To change it, edit `data.mjs` and run `node --test scripts/ci/demo-data.test.mjs`. The tests check that all references resolve, the blocks and subtask graphs have no cycles, every e-mail address is under `@example.com`, no Polish letters appear, the default anchor is a Monday, start dates are not after due dates, milestones start on their due date and dependency types are `fs`, `ss`, `ff` or `sf`. They also check the layers, the guard that keeps base steps upstream-compatible (it must refuse Pro routes and fields), and that every feature a screenshot shows is still in the data.

## Troubleshooting

| Message | What to do |
| --- | --- |
| "The demo workspace ... already exists" | Pass `--reset`. |
| "does not accept the Origin" | Pass `--origin` with the instance's `KANEO_CLIENT_URL`. |
| "Sign-up is disabled" | Allow registration while the seed runs. |
| "may not create a workspace" | Seed into a fresh database, so Claire is the instance administrator. |
| "Refusing to seed ...: it is not localhost" | Read [Safety](#safety), then pass `--allow-remote` and your own password. |
| "The page talked to localhost" | The API or the web app was not started for the public host. See [Public hostname rehearsal](#public-hostname-rehearsal). |
| Chromium cannot be launched | Run `npm --prefix scripts/demo run setup`, or pass `--chromium <path>`. |
