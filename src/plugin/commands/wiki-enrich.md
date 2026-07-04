---
description: Queue LLM enrichment of the wiki using Claude Haiku + Sonnet. Requires ANTHROPIC_API_KEY.
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/codewiki.mjs enrich:*), Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/codewiki.mjs enrich)
---

# /wiki-enrich

Runs `node ${CLAUDE_PLUGIN_ROOT}/dist/codewiki.mjs enrich`. Requires
`ANTHROPIC_API_KEY` to be set in the environment.

Behaviour:

- File-level pages: Haiku generates "Notes" for files with cyclomatic > 15 OR
  no docstring OR tokens > 800. Cached by content hash.
- Module-level pages: Sonnet regenerates the public surface summary if any of
  its files changed. Cached.

This command runs in the background by default (the queue is concurrency-bounded
to 4). Progress is in `.codewiki/.summary-cache/`.

If `ANTHROPIC_API_KEY` is not set, the CLI prints a one-line warning and
exits cleanly — nothing to do.
