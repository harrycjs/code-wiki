---
description: Incrementally refresh the wiki based on git diff since the last index.
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/codewiki.mjs refresh:*), Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/codewiki.mjs refresh), Read
---

# /wiki-refresh

Run `node ${CLAUDE_PLUGIN_ROOT}/dist/codewiki.mjs refresh` in `${workspaceFolder}`.
Report:

1. Which files were re-indexed (git diff since last build, listed by the CLI).
2. Which modules were marked stale.
3. The new token totals if `.codewiki/.meta.json` changed.
