# code-wiki

> A Claude Code plugin that turns your repo into a browsable, **token-efficient** code wiki. Models read summaries on-demand instead of grepping source files.

## Why

Working with a large repo in Claude Code eats tokens. Every `Read` ships the whole file. Every `Grep` ships a slice. With `code-wiki`:

- `/wiki-build` indexes your repo into a `.codewiki/` directory of small markdown files (one per file / function / class / module) plus a JSON sidecar.
- Hooks then **automatically nudge** the model toward the wiki when it tries to `Read` source or `Grep` — without ever blocking it.
- The model reads a 600-token wiki page first, then drills into the 5-line function it actually needs.

Typical savings: 60-90% of "source-read" tokens on a medium codebase.

## Install

```bash
# Add the marketplace (one-time)
/plugin marketplace add <your-github-username>/code-wiki
/plugin marketplace update

# Install the plugin
/plugin install code-wiki@code-wiki
```

Or from source:

```bash
git clone https://github.com/<your-github-username>/code-wiki
cd code-wiki
npm install
npm run build
/plugin install .
```

## Usage

In any project where you want a wiki:

```text
/wiki-build
/wiki-architecture
/wiki-search login
/wiki-symbol src/auth/login.ts:function.loginUser
/wiki-graph loginUser
/wiki-refresh      # after edits
/wiki-help
```

**MCP tools** (auto-discovered by Claude Code):

- `wiki_search` — find symbols/files/modules
- `wiki_drill` — read a wiki page by id
- `wiki_callers` / `wiki_callees` — graph queries
- `wiki_changed_since` — git delta

## How the auto-nudge works

After you run `/wiki-build`, four layers of hooks guide the model toward `.codewiki/` pages:

1. **Session banner** at session start tells the model the wiki exists.
2. **Per-prompt reminder** ("prefer wiki over source").
3. **Pre-tool nudge** on `Read | Grep | Glob | Bash` injects a reason pointing at the corresponding `.codewiki/` page.
4. **Post-read note** after any source `Read` so the model has the wiki path next time.

No nudges block the model — they're suggestions, not gates.

## Optional: LLM enrichment

If you set `ANTHROPIC_API_KEY`, `/wiki-enrich` deepens summaries using Claude Haiku (per file) and Sonnet (per module). Static summaries ship by default. Without an API key: zero cost, zero network, full coverage.

## Project layout

- `src/cli/` — the `codewiki` binary (build/refresh/watch/search/show/validate/clean)
- `src/core/` — pure indexing logic, no Claude/MCP coupling
- `src/mcp/` — the MCP server Claude Code talks to
- `src/plugin/` — the Claude Code plugin surface (manifest, commands, hooks, CLAUDE.md)
- `examples/fixture-ts/` — small TS fixture used by integration tests
- `docs/` — VitePress site
- `tests/` — vitest

## Wiki format (v1)

```
.codewiki/
├── .meta.json                # build metadata, git HEAD, model versions
├── .index.json               # machine-readable tree
├── .graph.json               # import + call edges
├── .state.json               # incremental state
├── .summary-cache/           # only if enrichment ran
├── architecture.md
├── INDEX.md
├── modules/<name>.md         # one per logical module
├── files/<path>.md           # one per source file
└── symbols/<path>/<kind>.<name>.md   # one per function / class
```

Each page carries YAML frontmatter; the model can rely on consistent fields.

## Status

- ✅ M1 — scaffolding, walker, minimal render, CLI
- 🚧 M2 — tree-sitter extraction (TS family)
- 📋 M3-M9 — see `CHANGELOG.md` and the design doc

## License

Apache-2.0. See [LICENSE](./LICENSE).
