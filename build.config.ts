import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    {
      input: 'src/index.ts',
      name: 'code-wiki',
    },
    {
      input: 'src/cli/index.ts',
      name: 'codewiki',
      bin: 'codewiki',
    },
    {
      input: 'src/mcp/server.ts',
      name: 'code-wiki-mcp',
    },
  ],
  clean: true,
  // We do NOT use `externals` — the plugin must be self-contained and
  // runnable without a package.json pointer at the install location.
  // Dependencies (commander, p-queue, pino, tree-sitter grammars, etc.)
  // get inlined into dist/chunks/*. mjs by unbuild's rollup.
  rollup: {
    inlineDependencies: true,
  },
  failOnWarn: false,
  outDir: 'dist',
})
