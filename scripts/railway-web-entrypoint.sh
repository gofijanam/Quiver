#!/bin/sh
set -eu

if [ -n "${QUIVER_WEB_DB_PATH:-}" ]; then
  db_dir=$(dirname "$QUIVER_WEB_DB_PATH")
  mkdir -p "$db_dir"
  chown node:node "$db_dir"
fi

exec gosu node "$@"
