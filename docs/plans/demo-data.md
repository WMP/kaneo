# Plan: demo data, public demo and end-to-end tests

Status: proposed on 2026-09-30. Stage 1 is in progress on `claude/affectionate-meitner-5vs2af`. Stages 2 to 4 need the decisions listed below before they start.

## Goal

One fictional dataset, created through the public API, serves three uses:

1. the README screenshots;
2. a public demo instance on a public domain;
3. end-to-end tests that record videos and screenshots;
4. the check of each weekly upstream merge: seed the upstream-compatible data on plain Kaneo, upgrade to Kaneo Pro, and confirm that nothing was lost.

## Assumptions

- The dataset is fictional: the company "Northwind Robotics", people with international names, and addresses under `example.com`, a reserved domain that never receives mail.
- The seed uses only the HTTP API (Better Auth sign-up and the Kaneo routes), never SQL. It therefore works against any deployment (local, Docker, Helm) and goes through the same authorization and events as a real client.
- Dates are offsets from an anchor, by default the Monday of the current week (UTC), so a long-running demo keeps looking current. A fixed `--anchor` reproduces the same layout.
- The tool is a standalone npm package in `scripts/demo/`, like `scripts/ui-review-bot/`. It does not change the pnpm workspace or its lockfile.

## Stages

| Stage | Scope | Verification |
| --- | --- | --- |
| 1 | Dataset (`data.mjs`), seed (`seed.mjs` as a CLI and `seedDemo()`), capture (`capture.mjs`: screenshots, optional videos), a local rehearsal of a public hostname, dataset tests in `scripts/ci/`, README screenshots regenerated from the seed. | `node --test scripts/ci/*.test.mjs` in CI; a seed run twice with `--reset` against a fresh database; a person checks every screenshot. |
| 2 | End-to-end suite on the Playwright test runner. Global setup calls `seedDemo()` against a fresh database and reads the ids from `--out`. Videos and screenshots are kept as CI artifacts on failure. A CI job with the PostgreSQL service. | The suite passes in CI, and a deliberate UI break makes it fail. |
| 3 | Public demo instance on a dedicated domain: hardened configuration, a scheduled reset (drop the database, migrate, seed) and sign-in instructions for visitors. | The reset runs on schedule, followed by a smoke test of the demo. |
| 4 | Verified weekly upstream sync and releases compatible with Kaneo: a skill that runs the sync and starts agents to resolve the merge, a log of hard merge decisions, a list of upstream changes that are deliberately not merged, the upgrade check below, and a Kaneo Pro release that names the Kaneo version it is compatible with. | The upgrade check passes for the merge candidate, and a second run of the skill reuses the recorded decisions without asking again. |

## Data layers

Every entity in the dataset belongs to one layer:

- `base`: data that upstream Kaneo supports (accounts, workspace and members, projects, columns, labels, tasks with one assignee, comments, relations without dependency type, project custom fields). The seed creates it only through routes and fields that exist upstream, so it runs against a plain Kaneo instance.
- `pro`: the Kaneo Pro additions (dependency types and lag, progress, milestones, baselines, date constraints, approval gates, the working calendar, workspace custom fields, multiple assignees, resources, project memberships and invitations).

Seeding `base` and then `pro` gives the same end state as seeding both at once.

## Stage 4: verified upstream sync (next pull request)

The weekly workflow `upstream-sync.yml` already opens one merge pull request. A skill in `.claude/skills/upstream-sync/` takes it from there:

1. **Merge.** Start agents to resolve the conflicts, one per area. Before an agent resolves a conflict, it reads the decision log. After it resolves a hard conflict, it adds an entry. A person approves the merge pull request.
2. **Upgrade check.** It extends the existing CI upgrade test (`scripts/ci/upgrade.sh`, `scripts/ci/upgrade.mjs`):
   1. Start the latest upstream Kaneo release on an empty database and seed the `base` layer.
   2. Read the base data through the API as the owner and capture the base views.
   3. Upgrade the same database to the Kaneo Pro candidate.
   4. Check that every base entity is still there with the same values, and that the base views show the same data. Compare the data shown, not the pixels: the two user interfaces differ. For example, compare text read from the page, or let a person or an agent review the screenshots side by side.
   5. Seed the `pro` layer and run the Kaneo Pro checks (later also the end-to-end suite).
3. **Release.** Tag a Kaneo Pro version that records the Kaneo version it is compatible with, after CI passes for that exact commit (DEC-RELEASE-01).

Records to add in that pull request:

- `docs/upstream-sync/decisions.md`: one entry per hard merge. It gives the date, the upstream commit or pull request, the files or area, the decision and the reason, and how to apply it next time.
- `docs/upstream-sync/exceptions.md`: upstream changes that are deliberately not merged. Each entry gives the upstream commit or path, the reason, what Kaneo Pro does instead, and when to review the exception.
- Optionally, recorded `git rerere` resolutions, so that an identical conflict resolves itself.

Known issues this stage must handle:

- **Migration order.** Drizzle applies a migration only when its journal `when` is newer than the newest applied migration. An upstream migration that is older than the fork's own migrations, such as `0054_backfill_instance_admin`, is silently skipped on existing Kaneo Pro databases unless the sync handles its timestamp.
- **Data stored elsewhere.** Project backgrounds and calendar feeds from Kaneo v2.28 and later are not carried over today. The upgrade check must report them until a migration copies them.
- **Project access.** After the upgrade, members without full access lose project access (migration `0056`). This is expected, so the check reads the base data as the owner.

## Decisions needed before stages 2 to 4

- **Domain and hosting** of the public demo.
- **Sign-in for visitors:** shared demo accounts with a published password, or another way in. Every change a visitor makes is lost at the next reset.
- **Configuration**, to verify on the demo instance: `DISABLE_REGISTRATION=true` after seeding, `DISABLE_WORKSPACE_CREATION=true`, `DISABLE_USER_DIRECTORY=true` (the account search reveals that accounts exist), `DISABLE_GUEST_ACCESS=true`, and no SMTP.
- **Reset frequency**, for example nightly.
- **Image to deploy.** Branch images are previews only (DEC-RELEASE-01, KAN-RELEASE-001). Deploy an image built from a commit whose CI passed, or close KAN-RELEASE-001 first.
- **CI cost** of the end-to-end job: every pull request, or only `main` and a nightly run.
- **Stage 4:** the version scheme of Kaneo Pro releases, where the upgrade check runs (it needs Docker for the upstream image), and which agents may resolve merges.

## Safety

- The seed creates accounts with a known password. Run it only against a local or a dedicated demo instance, never against production data or credentials (see AGENTS.md).
- The seed refuses an API outside localhost unless `--allow-remote` is set and the password comes from `KANEO_DEMO_PASSWORD`.
- `--reset` deletes only the demo workspace owned by the demo owner.
