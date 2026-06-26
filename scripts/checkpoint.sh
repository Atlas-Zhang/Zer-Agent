#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: scripts/checkpoint.sh <message> <path> [path...]" >&2
  exit 1
fi

message="$1"
shift

if [ -z "$(git status --porcelain)" ]; then
  echo "Nothing to commit." >&2
  exit 1
fi

git add -- "$@"

if [ -z "$(git diff --cached --name-only)" ]; then
  echo "No staged changes were produced." >&2
  exit 1
fi

git commit -m "$message"
