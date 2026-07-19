#!/usr/bin/env bash

set -euo pipefail

# One-time setup:
# 1. In Supabase, open Project Settings -> API Keys.
# 2. Copy the secret/service_role key.
# 3. Add these server-only variables to .env.local:
#
#    SUPABASE_URL=https://YOUR_PROJECT.supabase.co
#    SUPABASE_SERVICE_ROLE_KEY=YOUR_SECRET_SERVICE_ROLE_KEY
#
# Never prefix the service-role key with VITE_, and never commit .env.local.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.local"
PILOT_CSV="${1:-$ROOT_DIR/data/debug_pairs_cmn.csv}"
OUTPUT_JSON="${2:-$ROOT_DIR/pilot_cue_pairs.json}"
TARGET_LABELS="${TARGET_LABELS:-3}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  echo "Create it and add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# Reuse the browser project URL when a separate server-side URL was not added.
SUPABASE_URL="${SUPABASE_URL:-${VITE_SUPABASE_URL:-}}"

if [[ -z "$SUPABASE_URL" ]]; then
  echo "Missing SUPABASE_URL (or VITE_SUPABASE_URL) in $ENV_FILE"
  exit 1
fi

if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "Missing SUPABASE_SERVICE_ROLE_KEY in $ENV_FILE"
  echo "Find it in Supabase: Project Settings -> API Keys -> Secret/service_role key."
  exit 1
fi

if [[ ! -f "$PILOT_CSV" ]]; then
  echo "Pilot CSV not found: $PILOT_CSV"
  exit 1
fi

echo "Converting pilot data: $PILOT_CSV"
python3 "$ROOT_DIR/scripts/csv_to_cue_pairs.py" "$PILOT_CSV" > "$OUTPUT_JSON"

echo "Uploading pilot batch to Supabase"
SUPABASE_URL="$SUPABASE_URL" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
node "$ROOT_DIR/scripts/load_cue_pairs.js" "$OUTPUT_JSON" "$TARGET_LABELS" pilot

echo "Pilot cue pairs loaded successfully."

