import { describe, expect, test } from 'bun:test'

import { extractDocumentCode } from './generate-document'

// Parity tests with the gateway's ExtractPlaygroundDocumentCode: the chat
// service must keep accepting the same model replies the Go path accepted.
describe('extractDocumentCode', () => {
  test('picks the last python block over earlier sketches', () => {
    const reply = [
      'First a sketch:',
      '```python',
      'print("draft")',
      '```',
      'Now the real one:',
      '```python',
      'print("final")',
      '```',
    ].join('\n')
    expect(extractDocumentCode(reply)).toBe('print("final")')
  })

  test('accepts an untagged block when no python block exists', () => {
    const reply = 'Here you go:\n```\nimport x\n```\ndone'
    expect(extractDocumentCode(reply)).toBe('import x')
  })

  test('prefers python over untagged regardless of order', () => {
    const reply = '```\nplain\n```\n```py\nimport real\n```'
    expect(extractDocumentCode(reply)).toBe('import real')
  })

  test('accepts bare code only when it looks like a build script', () => {
    expect(
      extractDocumentCode(
        'import docx\ndoc.save("/workspace/out/report.docx")'
      )
    ).toContain('import docx')
    expect(extractDocumentCode('Sorry, I cannot do that.')).toBe('')
  })

  test('returns empty for an empty fence', () => {
    expect(extractDocumentCode('```python\n\n```')).toBe('')
  })
})
