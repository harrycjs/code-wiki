---
title: code-wiki
---

# code-wiki

> A Claude Code plugin that turns your repo into a browsable, **token-efficient** code wiki.

Claude reads a 600-token wiki page instead of a 6000-token source file. Models get summaries on-demand, then drill in only when they need the real source.

## Why

Working with a large repo in Claude Code eats tokens. Every `Read` ships the whole file. Every `Grep` ships a slice. With `code-wiki`:

- `/wiki-build` indexes your repo into a `.codewiki/` directory of small markdown files (one per file / function / class / module) plus a JSON sidecar.
- Hooks **automatically nudge** the model toward the wiki when it tries to `Read` source or `Grep` — without ever blocking it.
- The model reads a 600-token wiki page first, then drills into the 5-line function it actually needs.

Typical savings: **60-90%** of "source-read" tokens on a medium codebase.

## Install

Two paths — choose based on whether you've published to npm yet.

### Path A — local marketplace (no publish, fastest for testing)

```bash
git clone https://github.com/<your-github-username>/code-wiki
cd code-wiki
npm install
npm run build

bash scripts/install-plugin.sh user         # stages plugin + link node_modules
claude plugin marketplace update codebase-wiki-local
claude plugin install codebase-wiki@codebase-wiki-local
```

Restart Claude Code so the plugin hooks load.

### Path B — npm-published (recommended for team / public)

```bash
# In the code-wiki repo with NPM_TOKEN set:
npm run release                          # changeset version + npm publish

# In each user's project:
npm install -g codebase-wiki             # makes `codewiki` globally available
/plugin marketplace add <your-github-username>/code-wiki
/plugin install codebase-wiki@code-wiki
```

The plugin is self-contained either way — its slash commands invoke the
bundled CLI directly via `node ${CLAUDE_PLUGIN_ROOT}/dist/codewiki.mjs`,
so no global `codewiki` binary is strictly required.

## Usage

```text
/wiki-build           # build the wiki
/wiki-architecture    # system overview
/wiki-search login    # find symbols/files/modules
/wiki-symbol src/auth/login.ts:function.loginUser
/wiki-graph loginUser # callers / callees
/wiki-refresh         # after edits
/wiki-help            # one-screen summary
```

MCP tools (auto-discovered by Claude Code):

- `wiki_search`, `wiki_drill`, `wiki_callers`, `wiki_callees`, `wiki_changed_since`
- Resources: `wiki://tree`, `wiki://architecture`, `wiki://module/...`, `wiki://file/...`, `wiki://symbol/...`

## How the auto-nudge works

After `/wiki-build`, four layers of hooks nudge the model toward `.codewiki/`:

1. **Session banner** at session start tells the model the wiki exists.
2. **Per-prompt reminder** ("prefer wiki over source").
3. **Pre-tool nudge** on `Read | Grep | Glob | Bash cat/head/tail` injects a `permissionDecisionReason` pointing at the matching wiki page, with a `use_mcp_tool('code-wiki', 'wiki_search', { query: "..." })` example for Grep.
4. **Post-read note** after any source `Read` so the model has the wiki path next time.

Each nudge carries the file's freshness state: if the source is newer than the wiki, the model is told to run `/wiki-refresh` first.

No nudges block — they're suggestions, not gates.

## Optional: LLM enrichment

If `ANTHROPIC_API_KEY` is set, `/wiki-enrich` deepens summaries using:

- **Haiku** for files with cyclomatic complexity > 15 OR no docstring OR > 800 tokens source.
- **Sonnet** for modules whose files changed.

Cost per build: **$0.001 / complex file + $0.005 / module**. Results are cached by content hash; re-runs without source edits are free.

Without an API key: zero cost, zero network, full coverage.

## Project layout

- `src/cli/` — the `codewiki` binary (build / refresh / watch / search / show / enrich / invalidate / validate / clean).
- `src/core/` — pure indexing logic, no Claude/MCP coupling.
- `src/core/extract/` — tree-sitter symbol extraction across 10 languages.
- `src/core/graph/` — import edge extraction.
- `src/core/incremental.ts` — git diff + chokidar watcher + state.json.
- `src/core/render/` — markdown templates for all 5 page kinds.
- `src/core/summary/llm.ts` — optional Haiku/Sonnet enrichment.
- `src/mcp/` — the MCP server Claude Code talks to.
- `src/plugin/` — the Claude Code plugin surface (manifest, commands, hooks, CLAUDE.md).
- `examples/fixture-ts` — small TS lib used for integration tests.

## License

Apache-2.0. See [LICENSE](https://github.com/<your-github-username>/code-wiki/blob/main/LICENSE).
