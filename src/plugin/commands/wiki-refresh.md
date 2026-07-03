---
description: Incrementally refresh the wiki based on git diff since the last index.
allowed-tools: Bash(codewiki refresh:*), Read
---

# /wiki-refresh

Run `codewiki refresh` in `${workspaceFolder}`. Report:

1. Which files were re-indexed (git diff since last build).
2. Which modules were marked stale.
3. The new token totals (if `.codewiki/.meta.json` changed).
