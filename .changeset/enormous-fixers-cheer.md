---
"code-wiki": minor
---

Initial v0.1.0 release of `code-wiki`.

- M1: scaffold + walker + minimal render.
- M2: tree-sitter extraction for TS/JS/TSX/JSX.
- M3: 7 more language extractors (Python / Go / Rust / Java / C / C++ / Ruby).
- M4: graph extraction — imports + dependents; usable by `wiki_callers` / `wiki_callees` MCP tools.
- M5: MCP resource pagination, smarter auto-nudge hooks (config-driven, freshness-aware).
- M6: incremental refresh — `codewiki refresh` uses git diff; `codewiki watch` runs chokidar.
- M7: optional LLM enrichment — file-level Haiku + module-level Sonnet, content-hash cached.
- M8: Mermaid diagrams in architecture.md and module pages.
