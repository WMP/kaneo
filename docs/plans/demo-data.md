# Plan: demo data, public demo and end-to-end tests

Status: proposed on 2026-09-30. Stage 1 is in progress on `claude/affectionate-meitner-5vs2af`. Stages 2 and 3 need the decisions listed below before they start.

## Goal

One fictional dataset, created through the public API, serves three uses:

1. the README screenshots;
2. a public demo instance on a public domain;
3. end-to-end tests that record videos and screenshots.

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

## Decisions needed before stages 2 and 3

- **Domain and hosting** of the public demo.
- **Sign-in for visitors:** shared demo accounts with a published password, or another way in. Every change a visitor makes is lost at the next reset.
- **Configuration**, to verify on the demo instance: `DISABLE_REGISTRATION=true` after seeding, `DISABLE_WORKSPACE_CREATION=true`, `DISABLE_USER_DIRECTORY=true` (the account search reveals that accounts exist), `DISABLE_GUEST_ACCESS=true`, and no SMTP.
- **Reset frequency**, for example nightly.
- **Image to deploy.** Branch images are previews only (DEC-RELEASE-01, KAN-RELEASE-001). Deploy an image built from a commit whose CI passed, or close KAN-RELEASE-001 first.
- **CI cost** of the end-to-end job: every pull request, or only `main` and a nightly run.

## Safety

- The seed creates accounts with a known password. Run it only against a local or a dedicated demo instance, never against production data or credentials (see AGENTS.md).
- The seed refuses an API outside localhost unless `--allow-remote` is set and the password comes from `KANEO_DEMO_PASSWORD`.
- `--reset` deletes only the demo workspace owned by the demo owner.
