import type { Language, Symbol } from '../types.js'
import { extractWithGrammar } from './typescript.js'

/**
 * Symbol extractor dispatcher. M2 only supports the TypeScript family;
 * M3 will add the remaining 7 languages.
 */

export interface ExtractInput {
  source: string
  repoPath: string
  language: Language
}

export async function extractSymbols(input: ExtractInput): Promise<Symbol[]> {
  const { source, repoPath, language } = input
  if (!source) return []
  switch (language) {
    case 'typescript':
    case 'tsx':
    case 'javascript':
    case 'jsx':
      return extractWithGrammar(source, language, repoPath)
    default:
      // M3 will dispatch to Py/Go/Rust/Java/C/C++/Ruby extractors.
      return []
  }
}

export function isExtractable(language: Language): boolean {
  return (
    language === 'typescript' ||
    language === 'tsx' ||
    language === 'javascript' ||
    language === 'jsx'
  )
}
