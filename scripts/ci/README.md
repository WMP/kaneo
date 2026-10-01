# CI checks

`ci.yml` runs on PRs and main, and is reused by Nightly. It checks formatting,
translations, OpenAPI, types, unit/integration tests, site links, workflow syntax,
real S3 uploads, and all three Dockerfiles. The bundled image is loaded and run
against disposable PostgreSQL and MinIO services for browser, realtime and
upgrade tests. Runtime failures retain container logs, a browser screenshot and
a Playwright trace for seven days.

The disposable S3 fixture pins Bitnami's archived MinIO 2025.7.23 image by its
multi-platform digest because the upstream public registries no longer serve
the previous image. It runs the MinIO binary directly with temporary test data.

- `browser.mjs`: real sign-in, project/task creation, status changes, another
  tab's realtime cache update, reload persistence and cross-workspace denial.
- `realtime.mjs`: authenticated clients receive the same mutation with no Redis,
  and when connected to separate API instances sharing Redis.
- `upgrade.sh` / `upgrade.mjs`: resolve the latest stable GitHub release to an
  image digest, seed it through public APIs, then replace it with the candidate
  image on the same database. Verify account credentials, owner membership,
  project/task fields, comments, private image bytes and subsequent writes.
  The release comes from `KANEO_UPGRADE_SOURCE_REPO` (default: the current
  repository); this fork's CI sets it to `usekaneo/kaneo` because the fork
  publishes no releases.
- `require-ci.mjs`: release publication requires the latest CI run for the exact
  main SHA to succeed. It accepts push and manual CI runs, waits up to 30 minutes,
  and rejects failed, cancelled and skipped runs. If no push run exists (for
  example a release commit containing `[skip ci]`), dispatch **CI** on main before
  dispatching **Release**. Dry runs don't wait or publish.

- `check-migration-order.mjs`: fails when a journal entry after the upstream
  baseline has a `when` that is not newer than every earlier entry, because
  Drizzle would silently skip it on existing databases. The unit test runs it
  against the real journal, and `upstream-sync.yml` runs it with `--incoming
  <upstream journal>` to flag upstream migrations older than our newest one.

Helm validation also executes the existing secret and upgrade-rendering
regression checks. Configure the new job checks as required in GitHub if they
should block merging; editing workflows alone does not change branch
protection.

## Local runtime checks

Use disposable services only. The HTTP helpers refuse non-loopback origins.
No root `.env`, production credentials or cloud storage are needed. You need
Docker, Node, pnpm, the API workspace dependencies and the existing browser
runner's dependencies (`npm ci --ignore-scripts --prefix scripts/ui-review-bot`).

After building a candidate image tagged `kaneo:ci`:

```sh
docker compose --env-file /dev/null -p kaneo-ci -f scripts/ci/compose.yml up -d --wait postgres minio app
node scripts/ci/browser.mjs http://127.0.0.1:55173
node scripts/ci/realtime.mjs http://127.0.0.1:55173
KANEO_CI_REDIS_URL=redis://redis:6379 docker compose --env-file /dev/null -p kaneo-ci -f scripts/ci/compose.yml --profile realtime up -d --wait app second redis
node scripts/ci/realtime.mjs http://127.0.0.1:55173 http://127.0.0.1:55174
KANEO_UPGRADE_SOURCE_REPO=usekaneo/kaneo bash scripts/ci/upgrade.sh
```

Install Chromium once using
`scripts/ui-review-bot/node_modules/.bin/playwright install chromium`.
Stop only this stack and remove its disposable data afterwards:

```sh
docker compose --env-file /dev/null -p kaneo-ci -f scripts/ci/compose.yml --profile realtime --profile upgrade down -v
```

The stack reserves loopback ports 55173–55175, 59040, 59379 and 59432. It uses
fixed synthetic credentials and test databases; do not expose it to the network.

For a local worktree on a copy-on-write filesystem, reuse the pnpm store without
copying dependency data:

```sh
pnpm install --offline --frozen-lockfile --ignore-scripts --package-import-method=clone
```

This preserves independent workspace links. The logical `node_modules` size
still includes shared blocks; it is not the additional physical disk cost.
