---
description: Show callers and callees of a symbol.
allowed-tools: Bash(codewiki show:*), Read
---

# /wiki-graph <symbol>

Arguments: $ARGUMENTS

Look up the symbol in `.codewiki/.graph.json` (or call the `wiki_callers` and
`wiki_callees` MCP tools with the symbol id). Print:

- Incoming edges (callers), grouped by file.
- Outgoing edges (callees), grouped by file.

Limit to 20 edges each direction. If more exist, say so and offer to expand.
