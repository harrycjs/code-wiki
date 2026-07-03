---
description: Show the wiki page for a specific symbol or file (function, class, etc.).
allowed-tools: Bash(codewiki show:*), Read
---

# /wiki-symbol <path>:<name>

Arguments: $ARGUMENTS

Examples:

- `/wiki-symbol src/auth/login.ts:function.loginUser`
- `/wiki-symbol src/auth/login.ts:class.AuthService`
- `/wiki-symbol src/auth/login.ts` (the whole file page)

Run `codewiki show "$ARGUMENTS"` and read the result. Summarize:

1. The symbol's purpose (paraphrase the Description).
2. Its signature.
3. Its callers and callees (from `wiki_callers` and `wiki_callees` MCP tools).
