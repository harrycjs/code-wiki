import type { Language, Symbol } from '../types.js'
import { extractWithGrammar } from './typescript.js'
import { extractOtherLanguage } from './langs.js'

/**
 * Symbol extractor dispatcher. M2 supports the TS/JS family; M3 adds the
 * remaining 7 languages.
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
    case 'python':
    case 'go':
    case 'rust':
    case 'java':
    case 'c':
    case 'cpp':
    case 'ruby':
      return extractOtherLanguage(source, language, repoPath)
    default:
      return []
  }
}

export function isExtractable(language: Language): boolean {
  return (
    language === 'typescript' ||
    language === 'tsx' ||
    language === 'javascript' ||
    language === 'jsx' ||
    language === 'python' ||
    language === 'go' ||
    language === 'rust' ||
    language === 'java' ||
    language === 'c' ||
    language === 'cpp' ||
    language === 'ruby'
  )
}
