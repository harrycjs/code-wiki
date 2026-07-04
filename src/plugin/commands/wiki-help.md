---
description: Show available wiki commands.
allowed-tools:
---

# /wiki-help

Print a one-screen summary:

## Slash commands

- `/wiki-build` — Build or rebuild the wiki
- `/wiki-refresh` — Incremental refresh
- `/wiki-search <query>` — Search symbols/files/modules
- `/wiki-symbol <path>:<name>` — Read one symbol page
- `/wiki-architecture` — System overview + diagram
- `/wiki-graph <symbol>` — Callers and callees
- `/wiki-enrich` — Optional LLM enrichment (API key required)
- `/wiki-help` — This help

## MCP tools (auto-discovered)

- `wiki_search`, `wiki_drill`, `wiki_callers`, `wiki_callees`, `wiki_changed_since`

## MCP resources

- `wiki://tree` — Top-level module index
- `wiki://architecture` — Architecture overview
- `wiki://module/<id>` — A module page
- `wiki://file/<path>` — A file page
- `wiki://symbol/<id>` — A symbol page

## Onboarding

1. Run `/wiki-build` once.
2. Edit files normally — the PostToolUse hook invalidates changed wiki pages.
3. Run `/wiki-refresh` after significant edits, or just keep working — the watcher auto-rebuilds.

## Note

The CLI is bundled inside the plugin at
`${CLAUDE_PLUGIN_ROOT}/dist/codewiki.mjs`. No global `npm install` is
required — the slash commands invoke it via `node` directly.

## Auto-nudge

After `/wiki-build`, every `Read | Grep | Glob | Bash cat/head/tail` call you
make will receive a one-line reminder pointing at the matching `.codewiki/`
page. This is the source of the token savings — lean into it.
