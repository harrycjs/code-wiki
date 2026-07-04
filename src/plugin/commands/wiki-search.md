---
description: Search the wiki for symbols, files, or modules matching a query.
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/codewiki.mjs search:*), Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/codewiki.mjs search)
---

# /wiki-search <query>

Arguments: $ARGUMENTS

Run `node ${CLAUDE_PLUGIN_ROOT}/dist/codewiki.mjs search "$ARGUMENTS" --limit 20`
in `${workspaceFolder}` and present the top results as a table with columns:
Kind, Name, File, Module.

After the table, suggest specific drill-in commands. For example, if a symbol
hit appears:

- `/wiki-symbol src/auth/login.ts:function.loginUser` to read the symbol page
- or call the MCP tool `wiki_drill` with the symbol id
