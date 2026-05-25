#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ADO_MCP_ENV_FILE:-/Users/lushevol/code/github/code-review-agent/.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ -z "${ADO_ORGANIZATION:-}" ]]; then
  echo "ADO_ORGANIZATION is required for Azure DevOps MCP." >&2
  exit 1
fi

if [[ -z "${ADO_TOKEN:-}" ]]; then
  echo "ADO_TOKEN is required for Azure DevOps MCP PAT authentication." >&2
  exit 1
fi

PERSONAL_ACCESS_TOKEN="$(
  printf 'codex:%s' "$ADO_TOKEN" | base64 | tr -d '\n'
)"
export PERSONAL_ACCESS_TOKEN

exec npx -y @azure-devops/mcp "$ADO_ORGANIZATION" --authentication pat
