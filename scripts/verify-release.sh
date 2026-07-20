#!/usr/bin/env bash

set -euo pipefail

ADO_ORGANIZATION="${ADO_ORGANIZATION:-lushe}"
ADO_PROJECT="${ADO_PROJECT:-project1}"
EXPECTED_AGENT_VERSION="${EXPECTED_AGENT_VERSION:-0.1.10}"
EXPECTED_STORE_VERSION="${EXPECTED_STORE_VERSION:-0.1.1}"
PR_ID=""
SCAN_PR=false
EXPECTED_DECISION=""
EXPECT_FENCED_SUGGESTION=false

usage() {
  printf '%s\n' "Usage: $0 [--pr-id ID] [--scan-pr ID] [--expect-decision allowed|blocked] [--expect-fenced-suggestion]"
  printf '%s\n' ""
  printf '%s\n' "Runs read-only release, environment, ADO authentication, and optional PR-access checks."
  printf '%s\n' "--scan-pr additionally starts a real review and therefore posts ADO comments/statuses."
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --)
      shift
      ;;
    --pr-id)
      PR_ID="${2:?--pr-id requires an ID}"
      shift 2
      ;;
    --scan-pr)
      PR_ID="${2:?--scan-pr requires an ID}"
      SCAN_PR=true
      shift 2
      ;;
    --expect-decision)
      EXPECTED_DECISION="${2:?--expect-decision requires allowed or blocked}"
      if [[ "$EXPECTED_DECISION" != "allowed" && "$EXPECTED_DECISION" != "blocked" ]]; then
        printf '%s\n' "--expect-decision must be allowed or blocked" >&2
        exit 2
      fi
      shift 2
      ;;
    --expect-fenced-suggestion)
      EXPECT_FENCED_SUGGESTION=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

require_environment() {
  local variable_name="$1"
  if [[ -z "${!variable_name:-}" ]]; then
    printf 'Missing required environment variable: %s\n' "$variable_name" >&2
    exit 1
  fi
}

check_version() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$actual" != "$expected" ]]; then
    printf '%s version mismatch: expected %s, got %s\n' "$label" "$expected" "$actual" >&2
    exit 1
  fi
  printf 'OK  %s %s\n' "$label" "$actual"
}

require_command curl
require_command node
require_command npm
require_command ratan-code-review

require_environment ADO_TOKEN
require_environment DEEPSEEK_ANTHROPIC_BASE_URL
require_environment DEEPSEEK_OPENAI_BASE_URL
require_environment DEEPSEEK_API_KEY
require_environment DEEPSEEK_LLM_MODEL

printf 'OK  required environment variables are set (values hidden)\n'

store_version="$(npm view "finding-store@${EXPECTED_STORE_VERSION}" version)"
agent_version="$(npm view "ratan-code-review@${EXPECTED_AGENT_VERSION}" version)"
installed_version="$(ratan-code-review --version)"
check_version "finding-store registry" "$EXPECTED_STORE_VERSION" "$store_version"
check_version "ratan-code-review registry" "$EXPECTED_AGENT_VERSION" "$agent_version"
check_version "installed ratan-code-review" "$EXPECTED_AGENT_VERSION" "$installed_version"

response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT

connection_url="https://dev.azure.com/${ADO_ORGANIZATION}/_apis/connectionData?connectOptions=1&lastChangeId=-1&lastChangeId64=-1"
http_status="$(curl -sS -u ":${ADO_TOKEN}" -o "$response_file" -w '%{http_code}' "$connection_url")"
if [[ "$http_status" != "200" ]]; then
  printf 'ADO authentication failed for organization %s (HTTP %s)\n' "$ADO_ORGANIZATION" "$http_status" >&2
  exit 1
fi
printf 'OK  ADO authentication for %s\n' "$ADO_ORGANIZATION"

if [[ -n "$PR_ID" ]]; then
  pr_url="https://dev.azure.com/${ADO_ORGANIZATION}/${ADO_PROJECT}/_apis/git/pullrequests/${PR_ID}?api-version=7.1"
  http_status="$(curl -sS -u ":${ADO_TOKEN}" -o "$response_file" -w '%{http_code}' "$pr_url")"
  if [[ "$http_status" != "200" ]]; then
    printf 'ADO PR access failed for %s/%s PR #%s (HTTP %s)\n' "$ADO_ORGANIZATION" "$ADO_PROJECT" "$PR_ID" "$http_status" >&2
    exit 1
  fi
  pr_summary="$(node -e 'const fs=require("fs"); const pr=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(`${pr.repository?.name ?? "unknown repo"} — ${pr.title ?? "untitled"} [${pr.status ?? "unknown"}]`)' "$response_file")"
  printf 'OK  ADO PR #%s: %s\n' "$PR_ID" "$pr_summary"
fi

if [[ "$SCAN_PR" == true ]]; then
  printf 'RUN real review for ADO PR #%s (comments and status may change)\n' "$PR_ID"
  export ADO_ORGANIZATION ADO_PROJECT
  export ADO_PROXY_URL=none
  (ratan-code-review start --pr-id "$PR_ID")
fi

if [[ -n "$EXPECTED_DECISION" ]]; then
  if [[ -z "$PR_ID" ]]; then
    printf '%s\n' "--expect-decision requires --pr-id or --scan-pr" >&2
    exit 2
  fi
  pr_url="https://dev.azure.com/${ADO_ORGANIZATION}/${ADO_PROJECT}/_apis/git/pullrequests/${PR_ID}?api-version=7.1"
  curl -sS -u ":${ADO_TOKEN}" -o "$response_file" "$pr_url"
  repo_id="$(node -e 'const fs=require("fs"); const pr=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(pr.repository.id)' "$response_file")"
  threads_file="${response_file}.threads"
  statuses_file="${response_file}.statuses"
  trap 'rm -f "$response_file" "$threads_file" "$statuses_file"' EXIT
  curl -sS -u ":${ADO_TOKEN}" -o "$threads_file" "https://dev.azure.com/${ADO_ORGANIZATION}/${ADO_PROJECT}/_apis/git/repositories/${repo_id}/pullRequests/${PR_ID}/threads?api-version=7.1"
  curl -sS -u ":${ADO_TOKEN}" -o "$statuses_file" "https://dev.azure.com/${ADO_ORGANIZATION}/${ADO_PROJECT}/_apis/git/repositories/${repo_id}/pullRequests/${PR_ID}/statuses?api-version=7.1"
  node scripts/assert-ado-review.mjs "$response_file" "$threads_file" "$statuses_file" "$EXPECTED_DECISION" "$EXPECT_FENCED_SUGGESTION"
fi

printf 'PASS release verification completed\n'
