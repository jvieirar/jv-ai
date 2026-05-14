#!/usr/bin/env bash
# Wrapper so MCP clients can start the server without passing env vars
# directly — credentials load from .env.local / .env.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

for f in "$SERVER_DIR/.env.local" "$SERVER_DIR/.env"; do
  if [[ -f "$f" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$f"
    set +a
    break
  fi
done

exec bun run "$SERVER_DIR/src/index.ts"
