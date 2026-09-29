// Pulls KaTeX and its stylesheet (~300 kB). Code reachable from the app shell
// must `import()` this module on demand (see components/ui/markdown.tsx)
// rather than import it statically.
import * as katex from 'katex'

import 'katex/dist/katex.min.css'

function normalizeMathSource(source: string): string {
  return source
    .trim()
    .replace(/^\\\(/, '')
    .replace(/\\\)$/, '')
    .replace(/^\\\[/, '')
    .replace(/\\\]$/, '')
}

export function renderMathToHtml(source: string, displayMode: boolean): string {
  return katex.renderToString(normalizeMathSource(source), {
    displayMode,
    output: 'htmlAndMathml',
    throwOnError: false,
  })
}
