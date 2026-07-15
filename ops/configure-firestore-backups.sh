#!/usr/bin/env bash
set -euo pipefail

project_id="${1:-}"
database_id="${2:-(default)}"

if [[ -z "${project_id}" ]]; then
  echo "Usage: CONFIRM_PROJECT=<project> $0 <project> [database]" >&2
  exit 2
fi
if [[ "${CONFIRM_PROJECT:-}" != "${project_id}" ]]; then
  echo "CONFIRM_PROJECT must exactly match ${project_id}" >&2
  exit 2
fi
if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud is required" >&2
  exit 2
fi

existing="$({
  gcloud firestore backups schedules list \
    --project="${project_id}" \
    --database="${database_id}" \
    --format='value(name)'
} 2>/dev/null)"

if [[ -n "${existing}" ]]; then
  echo "A Firestore backup schedule already exists:"
  echo "${existing}"
  echo "Review it before adding another schedule. No change was made."
  exit 0
fi

gcloud firestore backups schedules create \
  --project="${project_id}" \
  --database="${database_id}" \
  --recurrence=daily \
  --retention=14d

echo "Created a daily Firestore backup schedule with 14-day retention."
