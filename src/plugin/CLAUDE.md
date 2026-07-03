# Working with `.codewiki/`

If you see a `.codewiki/` directory in this project, the `code-wiki` Claude Code
plugin is enabled. **Prefer reading `.codewiki/` pages over reading source files
directly.** The wiki pages are short, structured, and the model is auto-nudged
toward them whenever you call `Read | Grep | Glob | cat | head | tail`.

## Workflow

1. On a new project or after a major refactor, suggest `/wiki-build` first.
2. To find a symbol: `/wiki-search <query>` or the `wiki_search` MCP tool.
3. To drill into a single symbol or file: `/wiki-symbol <path>:<name>` or `wiki_drill`.
4. To understand callers/callees: `/wiki-graph <symbol>`.
5. After making non-trivial edits, suggest `/wiki-refresh` (the PostToolUse hook
   already marks changed files; refresh re-renders them).

## Hard rules

- **Never** write into `.codewiki/` directly. Always run `codewiki build` /
  `codewiki refresh`. The plugin permissions deny those writes for a reason.
- **Never** cat/head/tail a source file when its `.codewiki/files/...md` exists.
- After a long session, the `PreCompact` hook may have marked `.codewiki/` as
  possibly stale. Run `/wiki-refresh` proactively.

## Disabling

Set `nudge.enabled: false` in `.codewikirc` (or `package.json#code-wiki.nudge.enabled`)
to silence auto-nudges. The wiki itself stays usable.
