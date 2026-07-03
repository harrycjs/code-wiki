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
  externals: [
    '@anthropic-ai/sdk',
    '@modelcontextprotocol/sdk',
    'commander',
    'globby',
    'gpt-tokenizer',
    'ignore',
    'p-queue',
    'p-retry',
    'pino',
    'simple-git',
    'web-tree-sitter',
  ],
  rollup: {
    inlineDependencies: false,
  },
  failOnWarn: false,
  outDir: 'dist',
})
