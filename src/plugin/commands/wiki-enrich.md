---
description: Queue LLM enrichment of the wiki using Claude Haiku + Sonnet. Requires ANTHROPIC_API_KEY.
allowed-tools: Bash(codewiki enrich:*)
---

# /wiki-enrich

Runs the optional LLM-enrichment pass against `.codewiki/`. Requires
`ANTHROPIC_API_KEY` in the environment.

Behaviour:

- File-level pages: Haiku generates "Notes" for files with cyclomatic > 15 OR
  no docstring OR tokens > 800. Cached by content hash.
- Module-level pages: Sonnet regenerates the public surface summary if any of
  its files changed. Cached.

This command runs in the background by default (the queue is concurrency-bounded
to 4). Progress is in `.codewiki/.summary-cache/`.

If `ANTHROPIC_API_KEY` is not set, print a one-line warning and exit cleanly.
