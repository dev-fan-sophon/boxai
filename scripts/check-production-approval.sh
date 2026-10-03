#!/usr/bin/env bash
# Read-only release guard: missing/inaccessible approval policy blocks release.
set -euo pipefail

: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY required}"
policy="$(gh api "repos/${GITHUB_REPOSITORY}/environments/production")"
if ! jq -e '
  .can_admins_bypass == false and
  any(.protection_rules[]?;
    .type == "required_reviewers" and (.reviewers | length) > 0
  )
' <<< "$policy" >/dev/null; then
  echo "Production release blocked: configure required reviewers and disable administrator bypass in Settings → Environments → production." >&2
  exit 1
fi
echo "Production approval policy is configured; GitHub must approve the environment before release."
