---
description: Build or rebuild the codewiki for this repo. Run once on first use, or after a major refactor.
allowed-tools: Bash(codewiki build:*), Read
---

# /wiki-build

Run `codewiki build` in `${workspaceFolder}`. If `.codewiki/` already exists, this
will refresh only the changed files (git diff). Use `codewiki build --full` to
force a complete rebuild.

After the build finishes, print:

1. The number of modules, files, and symbols indexed (from `codewiki build` output).
2. The path `.codewiki/INDEX.md`.
3. A one-line summary of the largest module.

If `.codewiki/` already existed before this command, also note: "To refresh later,
use `/wiki-refresh` or simply edit files — the PostToolUse hook will invalidate
changed files automatically."
