---
description: Build or rebuild the codewiki for this repo. Run once on first use, or after a major refactor.
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/codewiki.mjs build:*), Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/codewiki.mjs build), Read
---

# /wiki-build

Run `node ${CLAUDE_PLUGIN_ROOT}/dist/codewiki.mjs build` in `${workspaceFolder}`.

The plugin ships the CLI binary at `${CLAUDE_PLUGIN_ROOT}/dist/codewiki.mjs`, so
no global npm install is required. If `.codewiki/` already exists, this runs
a smart rebuild (only re-parses files changed in git diff). Pass `--full` to
force a complete rebuild.

After the build finishes, report:

1. The number of modules, files, and symbols indexed (from the CLI output).
2. The path `.codewiki/INDEX.md`.
3. A one-line summary of the largest module.

If `.codewiki/` already existed before this command, also note: "To refresh
later, run `/wiki-refresh` or simply edit files — the PostToolUse hook
invalidates changed files automatically."
