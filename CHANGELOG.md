# Changelog

## [Unreleased]

### Added
- M1 scaffolding: `codewiki` CLI with `build / refresh / search / show / validate / clean` subcommands.
- Walker: globby + `.gitignore` / `.codewikiignore`-aware file traversal.
- Renderer: skeleton `.codewiki/` output with `INDEX.md`, per-file pages, per-module pages.
- Tokenizer: `gpt-tokenizer` wrapper (Claude tokenizer swap-ready).
- Plugin manifest, slash commands, hooks, and MCP server scaffolding.

### Pending
- M2 — tree-sitter symbol extraction (TS / JS / TSX / JSX).
- M3 — Python / Go / Rust / Java / C / C++ / Ruby extractors.
- M4 — graph extraction (imports + calls).
- M5 — MCP server resources + auto-nudge hooks.
- M6 — incremental refresh (git diff + chokidar).
- M7 — optional LLM enrichment.
- M8 — Mermaid diagrams.
- M9 — docs + release.
