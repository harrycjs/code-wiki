# Changelog

## 0.2.0

### Minor Changes

- 03a4d29: Initial v0.1.0 release of `code-wiki`.

  - M1: scaffold + walker + minimal render.
  - M2: tree-sitter extraction for TS/JS/TSX/JSX.
  - M3: 7 more language extractors (Python / Go / Rust / Java / C / C++ / Ruby).
  - M4: graph extraction — imports + dependents; usable by `wiki_callers` / `wiki_callees` MCP tools.
  - M5: MCP resource pagination, smarter auto-nudge hooks (config-driven, freshness-aware).
  - M6: incremental refresh — `codewiki refresh` uses git diff; `codewiki watch` runs chokidar.
  - M7: optional LLM enrichment — file-level Haiku + module-level Sonnet, content-hash cached.
  - M8: Mermaid diagrams in architecture.md and module pages.

## [Unreleased]

### Fixed

- Slash commands now invoke `${CLAUDE_PLUGIN_ROOT}/dist/codewiki.mjs` directly
  instead of relying on a globally-installed `codewiki` binary. Plugin is fully
  self-contained.
- `install-plugin.sh` ships the full dist tree (CLI + MCP server + `chunks/` +
  WASM grammars) **and** creates a Windows junction (or POSIX symlink) so the
  bundled modules can resolve `node_modules` at runtime.
- `loader.ts` adds a 3rd-resolution candidate that uses `import.meta.dirname`
  to find WASM grammars relative to the bundled chunk file. Fixes the
  `tree-sitter grammar wasm not found` warning when running from a project's
  working directory instead of the plugin's location.
- `build.config.ts` switches to `inlineDependencies: true` so the bundled
  output only depends on what's imported from the plugin's own tree (pino and
  similar packages had escaped inlining under the old config).

### Pending

- v0.1.0 tag — all 9 milestones + install fix ready.

## v0.1.0 (in progress, target tag)

### Added

- M1: scaffolding, walker, minimal render, hooks, MCP server stub.
- M2: tree-sitter extraction (TS / JS / TSX / JSX).
- M3: 7 more language extractors (Python / Go / Rust / Java / C / C++ / Ruby).
- M4: graph extraction — imports + dependents; `wiki_callers` / `wiki_callees`.
- M5: MCP resource pagination, smarter auto-nudge (config-driven, freshness-aware).
- M6: incremental refresh — `codewiki refresh` (git diff) + `codewiki watch` (chokidar).
- M7: optional LLM enrichment (Haiku + Sonnet, content-hash cached).
- M8: Mermaid diagrams in architecture + module pages.
- M9: docs site, GitHub Actions CI, changesets, issue templates.
