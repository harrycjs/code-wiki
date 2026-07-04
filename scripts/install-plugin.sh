#!/usr/bin/env bash
# Install the built code-wiki plugin into the local Claude Code plugins dir.
#
# Layout (Claude Code 2.1+):
#   ~/.claude/plugins/marketplaces/<name>/               <- we create this
#      .claude-plugin/marketplace.json
#      plugins/<plugin-name>/
#         .claude-plugin/plugin.json
#         ...rest of plugin surface...
#
# Usage: bash scripts/install-plugin.sh [user|project|local]   (default: user)

set -euo pipefail

PROFILE="${1:-user}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/dist/plugin"
DIST_FILE="$ROOT/dist/code-wiki-mcp.mjs"

if [ ! -d "$SRC" ]; then
  echo "error: $SRC not found. Run 'npm run build' first." >&2
  exit 1
fi
if [ ! -f "$DIST_FILE" ]; then
  echo "error: $DIST_FILE not found. Run 'npm run build' first." >&2
  exit 1
fi

# Destination: a "local marketplace" containing one plugin.
case "$PROFILE" in
  user)
    BASE="$HOME/.claude/plugins/marketplaces/code-wiki-local"
    ;;
  project|local)
    BASE="$ROOT/.claude-local-marketplace/code-wiki-local"
    ;;
  *)
    echo "usage: $0 [user|project|local]" >&2
    exit 2
    ;;
esac

PLUGIN_DIR="$BASE/plugins/code-wiki"
mkdir -p "$BASE/.claude-plugin" "$PLUGIN_DIR/.claude-plugin" "$PLUGIN_DIR/commands" "$PLUGIN_DIR/hooks" "$PLUGIN_DIR/dist"

# 1. Marketplace manifest
cat > "$BASE/.claude-plugin/marketplace.json" <<EOF
{
  "\$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "code-wiki-local",
  "description": "Local code-wiki plugin built from $ROOT",
  "owner": {
    "name": "local-user"
  },
  "plugins": [
    {
      "name": "code-wiki",
      "description": "Token-efficient code wiki for Claude Code. Generates a browsable .codewiki/ so the model reads summaries on-demand.",
      "version": "0.1.0",
      "source": "./plugins/code-wiki"
    }
  ]
}
EOF

# 2. Plugin manifest — src/plugin/manifest.json (top-level) is copied into both
#    the conventional .claude-plugin/plugin.json path AND kept at top-level for
#    back-compat with installers.
cp "$SRC/manifest.json"                    "$PLUGIN_DIR/.claude-plugin/plugin.json"
cp "$SRC/.mcp.json"                        "$PLUGIN_DIR/"
cp "$SRC/CLAUDE.md"                         "$PLUGIN_DIR/"
cp -r "$SRC/commands/."                    "$PLUGIN_DIR/commands/"
cp -r "$SRC/hooks/."                        "$PLUGIN_DIR/hooks/"
cp "$DIST_FILE"                            "$PLUGIN_DIR/dist/"

echo "ok: marketplace staged at $BASE"
echo "next: claude plugin marketplace add $BASE"
echo "      claude plugin install code-wiki@code-wiki-local"
