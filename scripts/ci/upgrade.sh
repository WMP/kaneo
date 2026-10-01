#!/usr/bin/env bash
set -euo pipefail

# A fork without releases of its own tests the upgrade from the project its
# installations come from; KANEO_UPGRADE_SOURCE_REPO names that repository.
source_repo=${KANEO_UPGRADE_SOURCE_REPO:-$GITHUB_REPOSITORY}
if [[ ! "$source_repo" =~ ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ ]]; then
  echo "KANEO_UPGRADE_SOURCE_REPO must be owner/name, got $source_repo" >&2
  exit 1
fi
# The standard GitHub latest release excludes prereleases and package-only releases.
tag=$(gh api "repos/$source_repo/releases/latest" --jq .tag_name)
version=${tag#v}
node scripts/security/validate-release-version.mjs "$version" --new-version
if [[ "$tag" != "v$version" ]]; then
  echo "Expected a stable Kaneo vX.Y.Z release, got $tag" >&2
  exit 1
fi
owner=$(printf '%s' "${source_repo%%/*}" | tr '[:upper:]' '[:lower:]')
image="ghcr.io/$owner/kaneo:$version"
docker pull "$image"
# Record and use the pulled digest so a mutable tag cannot change the baseline mid-test.
export KANEO_UPGRADE_IMAGE
authoritative_ref=$(docker image inspect "$image" --format '{{index .RepoDigests 0}}')
KANEO_UPGRADE_IMAGE=$authoritative_ref
mkdir -p .cache/ci-results
printf 'Upgrade baseline: %s\n' "$KANEO_UPGRADE_IMAGE" | tee .cache/ci-results/upgrade-baseline.txt
compose=(docker compose --env-file /dev/null -p kaneo-ci -f scripts/ci/compose.yml --profile upgrade)
"${compose[@]}" up -d --wait --wait-timeout 120 upgrade
node scripts/ci/upgrade.mjs seed http://127.0.0.1:55175 .cache/ci-results/upgrade-state.json
"${compose[@]}" stop upgrade
export KANEO_UPGRADE_IMAGE=kaneo:ci
"${compose[@]}" up -d --no-deps --wait --wait-timeout 120 --force-recreate upgrade
node scripts/ci/upgrade.mjs verify http://127.0.0.1:55175 .cache/ci-results/upgrade-state.json
