---
name: update-readme
description: Bring the Kaneo Pro README.md up to date with changes it does not describe yet, and add or retake its screenshots with the demo tool. Use when asked to update the README, after features land on main, or after a weekly upstream sync.
---

# Update the Kaneo Pro README

`README.md` describes only what Kaneo Pro adds to upstream Kaneo and how to run the fork. The `readme-baseline` comment at the top names the last `main` commit that the README covers. This skill finds the changes after that commit, writes them into the README, adds or retakes screenshots, and moves the marker.

Write everything in English (see AGENTS.md). Do not commit or push unless you are asked to.

## 1. List the changes the README does not cover

```bash
git fetch origin main
base=$(sed -n 's/.*readme-baseline: \([0-9a-f]\{7,40\}\).*/\1/p' README.md)
git log --no-merges --date=short --format='%h %ad %s' "$base"..origin/main -- \
  apps packages i18n charts .env.sample ENVIRONMENT_SETUP.md compose.yml compose.coolify.yml \
  Dockerfile.kaneo docs/agent-guide/invariants.md docs/agent-guide/project-decisions.md .github/workflows
git log --merges --date=short --format='%h %ad %s' "$base"..origin/main   # upstream syncs, see step 3
```

Read the diff and the code of every listed commit. A commit message is a hint, not proof.

## 2. Map each change to a README section

| Change | README section |
| --- | --- |
| New or changed user-facing feature | "Kaneo vs Kaneo Pro" table, "Features", a screenshot (step 4) |
| New MCP tool, or new fields on a tool | "MCP for AI agents" |
| New environment variable or Helm value | "Configuration" |
| New migration, changed data mapping or upgrade behavior | "Upgrading from Kaneo" |
| An invariant or a decision changes status | "Known limitations": remove a limitation only when `docs/agent-guide/invariants.md` marks it enforced |
| Image, Compose, Helm or release change | "Quick start" |
| Upstream sync | step 3 |

Skip refactors, tests and fixes that change nothing a reader of the README can see.

Rules:

- Describe what the code does today. Check every new claim in the code or the tests.
- Keep the structure and the tone. Add to an existing section before you add a new one.
- Keep the README about the differences from upstream. Link to the Kaneo documentation for shared behavior.
- Never add sponsors, other people's names or logins, third-party logos or tracking images.

## 3. After an upstream sync

- Update "Base version" in "Upgrading from Kaneo": the date of the upstream `main` that was merged and the releases around it.
- When upstream now has a feature that the table lists as Kaneo Pro only, correct the Kaneo column and the feature text.
- Update the release named in "Tested path". `scripts/ci/upgrade.sh` always upgrades from the latest upstream release.
- Check the migration and data-mapping bullets again against `apps/api/drizzle/`.

## 4. Add or retake screenshots

Use the demo tool. `scripts/demo/README.md` has the exact commands.

1. For a new UI feature, add its data to `scripts/demo/data.mjs` in the right layer: `base` only when upstream Kaneo has the feature, otherwise `pro`. Add a scene to `scripts/demo/capture.mjs`.
2. Start the app behind the public hostname rehearsal, seed a fresh database, and capture only the scenes you need (`--only`).
3. Keep the conventions from the README comment:
   - dark theme;
   - a 1440 CSS px viewport at 2x, cropped to the content;
   - fictional data (Northwind Robotics, international names, `@example.com`);
   - no `localhost`, no tokens.
4. Look at every new or changed PNG. Retake it when it is clipped, empty or shows a loading state. When the app itself renders the feature wrongly, leave the scene out and report the bug instead.
5. Name a new file with the next free two-digit prefix. Use a letter suffix (`07b`) for a second image in the same section. Delete a PNG that the README no longer uses.

## 5. Finish

1. Set `readme-baseline` to the `origin/main` commit you covered.
2. Run `node --test scripts/ci/*.test.mjs`. It checks the README links, anchors, images and marker, English content and the demo data.
3. Report the sections you changed, the screenshots you added or retook, and any claim you could not verify.
4. When you are asked to commit, put the README, the images and the demo changes in one commit.
