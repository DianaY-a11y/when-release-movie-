#!/usr/bin/env bash
# Copy snapshot JSONs from scraper/data/ into web/public/data/.
# Run after `marquee analyze all` (or any subset thereof) to refresh what the web app sees.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DATA="$SCRIPT_DIR/../web/public/data"
SRC_DATA="$SCRIPT_DIR/data"

mkdir -p "$WEB_DATA"

# Snapshots that must exist (heatmap, calendar, scoring).
REQUIRED=(
  weekly_industry.json
  weekly_indie.json
  legs.json
  decay_curves.json
)

# Snapshots that are optional (filled in by later phases).
OPTIONAL=(
  forward_schedule.json
  film_index.json
  film_tags.json
  embeddings.json
  backtest.json
)

copied=0
missing=0
for f in "${REQUIRED[@]}"; do
  if [[ -f "$SRC_DATA/$f" ]]; then
    cp "$SRC_DATA/$f" "$WEB_DATA/$f"
    echo "  ✓ $f"
    copied=$((copied + 1))
  else
    echo "  ✗ MISSING (required): $f"
    missing=$((missing + 1))
  fi
done
for f in "${OPTIONAL[@]}"; do
  if [[ -f "$SRC_DATA/$f" ]]; then
    cp "$SRC_DATA/$f" "$WEB_DATA/$f"
    echo "  ✓ $f"
    copied=$((copied + 1))
  fi
done

# Write meta.json with freshness timestamp.
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > "$WEB_DATA/meta.json" <<EOF
{
  "generated_at": "$TIMESTAMP",
  "snapshots_copied": $copied
}
EOF
echo "  ✓ meta.json (generated_at=$TIMESTAMP)"

if [[ $missing -gt 0 ]]; then
  echo "WARNING: $missing required snapshot(s) missing — web app will render with empty data."
  exit 1
fi
