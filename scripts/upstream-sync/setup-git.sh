#!/usr/bin/env bash
# One-time local git setup for an upstream sync. Idempotent: it changes only
# what is not set yet and prints every change.
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'USAGE'
Usage: scripts/upstream-sync/setup-git.sh

Sets, in the local repository config:
  rerere.enabled      true   (remember conflict resolutions)
  rerere.autoupdate   true   (stage files that rerere resolved)
  merge.renameLimit   20000  (large merges would otherwise skip rename detection)
and adds the remote "upstream" (https://github.com/usekaneo/kaneo) if missing.
Running it again changes nothing.
USAGE
  exit 0
fi

UPSTREAM_URL="https://github.com/usekaneo/kaneo"

git rev-parse --git-dir >/dev/null 2>&1 || {
  echo "Not inside a git repository." >&2
  exit 2
}

set_config() {
  local key="$1" value="$2" current
  current="$(git config --local --get "$key" || true)"
  if [[ "$current" == "$value" ]]; then
    echo "unchanged: $key = $value"
  else
    git config --local "$key" "$value"
    echo "changed:   $key = $value (was: ${current:-unset})"
  fi
}

set_config rerere.enabled true
set_config rerere.autoupdate true
set_config merge.renameLimit 20000

if git remote get-url upstream >/dev/null 2>&1; then
  echo "unchanged: remote upstream = $(git remote get-url upstream)"
else
  git remote add upstream "$UPSTREAM_URL"
  echo "changed:   added remote upstream = $UPSTREAM_URL"
fi
