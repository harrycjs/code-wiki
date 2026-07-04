# code-wiki

> A Claude Code plugin that turns your repo into a browsable, **token-efficient** code wiki. Models read summaries on-demand instead of grepping source.

[![GitHub](https://img.shields.io/badge/GitHub-harrycjs%2Fcode--wiki-blue)](https://github.com/harrycjs/code-wiki)
[![npm](https://img.shields.io/npm/v/codebase-wiki)](https://www.npmjs.com/package/codebase-wiki)

Claude reads a 600-token wiki page instead of a 6000-token source file. Models get summaries on-demand, then drill in only when they need the real source.

## Why

Working with a large repo in Claude Code eats tokens. Every `Read` ships the whole file. Every `Grep` ships a slice. With `code-wiki`:

- `/wiki-build` indexes your repo into a `.codewiki/` directory of small markdown files (one per file / function / class / module) plus a JSON sidecar.
- Hooks **automatically nudge** the model toward the wiki when it tries to `Read` source or `Grep` — without ever blocking it.
- The model reads a 600-token wiki page first, then drills into the 5-line function it actually needs.

Typical savings: **60–90%** of "source-read" tokens on a medium codebase.

## Two install paths

Pick one.

### Path A — Local marketplace (no publish required, fastest)

You point Claude Code at a directory on your machine that contains a `marketplace.json` describing the plugin. After `npm run build`, the install script stages everything.

```bash
git clone https://github.com/harrycjs/code-wiki
cd code-wiki

npm install
npm run build

# Stage plugin into your local Claude Code marketplaces dir + link it
# so the bundled CLI/MCP can resolve its node_modules.
bash scripts/install-plugin.sh user

claude plugin marketplace update codebase-wiki-local
claude plugin install codebase-wiki@codebase-wiki-local
```

Restart Claude Code (plugin registration happens at session start).

### Path B — npm (you ship to friends / your team's machines)

```bash
# In the code-wiki repo, with NPM_TOKEN in env:
npm run release   # changeset version + npm publish
```

Then in any target project:

```bash
npm install -g codebase-wiki       # puts `codewiki` on PATH
claude plugin marketplace add <your-github-username>/code-wiki
claude plugin install codebase-wiki@code-wiki
```

The plugin is then resolvable by the bundled CLI path inside the plugin
**and** via the global `codewiki` binary if you prefer using that.

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

Disable via `.codewikirc.json`:

```json
{ "nudge": { "enabled": false, "minFileLines": 50 } }
```

## Optional: LLM enrichment

If `ANTHROPIC_API_KEY` is set, `/wiki-enrich` deepens summaries using:

- **Haiku** for files with cyclomatic complexity > 15 OR no docstring OR > 800 tokens source.
- **Sonnet** for modules whose files changed.

Cost per build: **$0.001 / complex file + $0.005 / module**. Results are cached by content hash; re-runs without source edits are free.

Without an API key: zero cost, zero network, full coverage.

## Project layout

- `src/cli/` — the `codewiki` binary (build/refresh/watch/search/show/enrich/invalidate/validate/clean).
- `src/core/` — pure indexing logic, no Claude/MCP coupling.
- `src/core/extract/` — tree-sitter symbol extraction across 10 languages.
- `src/core/graph/` — import edge extraction.
- `src/core/incremental.ts` — git diff + chokidar watcher + state.json.
- `src/core/render/` — markdown templates for all 5 page kinds.
- `src/core/summary/llm.ts` — optional Haiku/Sonnet enrichment.
- `src/mcp/` — the MCP server Claude Code talks to.
- `src/plugin/` — the Claude Code plugin surface (manifest, commands, hooks, CLAUDE.md).
- `examples/fixture-ts` — small TS lib used for integration tests.
- `scripts/install-plugin.sh` — local-dev install helper (Path A above).

## Status

All 9 milestones shipped in v0.1.0. See [CHANGELOG.md](./CHANGELOG.md).

## License

Apache-2.0. See [LICENSE](./LICENSE).
