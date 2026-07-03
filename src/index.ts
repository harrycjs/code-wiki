// Top-level entry point for the npm package.
export { buildWiki } from './core/build.js'
export { loadConfig, type CodeWikiConfig, DEFAULT_CONFIG } from './core/config.js'
export { walkFiles, detectLanguage } from './core/walker.js'
export { groupModules, moduleForFile } from './core/modules.js'
export type {
  FileIndex,
  IndexTree,
  Language,
  ModuleInfo,
  Symbol,
  SymbolKind,
  WikiMeta,
  WikiPage,
  WikiState,
} from './core/types.js'
export { countTokens, truncateToTokens } from './core/tokenize.js'
