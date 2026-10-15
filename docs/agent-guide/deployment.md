# Deployment, CI and releases

Kaneo supports a bundled same-origin image and separate API/web images, Docker Compose and the Helm chart in `charts/kaneo/`. Redis remains optional. When changing runtime config, verify both a single API instance without Redis and any multi-instance path affected by the change. Environment variables are documented in `ENVIRONMENT_SETUP.md` and `.env.sample`.

`package.json`, CI and all three Dockerfiles (`Dockerfile.kaneo`, `apps/api/Dockerfile`, `apps/web/Dockerfile`) pin pnpm 10.32.1. The images still build through different paths, so treat them as distinct build checks.

The `CI` workflow runs on pull requests and pushes to `main`; see `.github/workflows/ci.yml` and `scripts/ci/README.md`. The latter describes disposable browser, realtime and upgrade checks. Local code changes cannot prove a branch protection setting or a remote workflow run passed: report those separately. Branch images from `.github/workflows/build-branch-images.yml` are preview images and are published on pushes to selected branches; that workflow has no dependency on CI for the same SHA. Do not treat the presence of a GHCR tag as test evidence.

The accepted policy, DEC-RELEASE-01 in [project decisions](project-decisions.md), keeps these images preview-only until a same-SHA CI gate protects publication. This is a future workflow change, not a guarantee of the current publisher.

Release is a deliberate `workflow_dispatch` from `main`, never an automatic consequence of a push. `.github/workflows/release.yml` resolves the next version from Conventional Commits, builds versioned images, validates Helm, and only then publishes version files, tag and GitHub Release. `:latest` and chart publication follow the versioned release. The dry run reports the version and notes without publishing. Release notes come from `scripts/release/notes.mjs`; versioned files are defined by `scripts/release/apply-version.mjs`.

Commit types drive the bump: `feat` minor, `fix`/`perf` patch, `feat!` or a `BREAKING CHANGE` footer major; `refactor` and `docs` appear in notes without a bump on their own. Before changing release behavior, verify the exact revision tested, built and tagged; inspect the relevant workflow and run its workflow-security checks. Never claim that an image built from a development branch is a released version.
