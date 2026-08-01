import { describe, expect, it } from 'vitest'

import {
  MAX_WEB_SEARCH_QUERY_CHARS,
  accumulateToolCallDeltas,
  buildWebSearchFollowupMessages,
  extractWebSearchCall,
} from './web-search-tool'

describe('accumulateToolCallDeltas', () => {
  it('merges id, name, and split arguments across streamed chunks', () => {
    const calls = accumulateToolCallDeltas(
      [],
      [
        { index: 0, id: 'call_1', function: { name: 'web_search' } },
        { index: 0, function: { arguments: '{"query":"vi' } },
        { index: 0, function: { arguments: 'etnam news"}' } },
      ]
    )

    expect(calls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'web_search', arguments: '{"query":"vietnam news"}' },
      },
    ])
  })

  it('keeps parallel calls separate by index and defaults a missing index to 0', () => {
    const calls = accumulateToolCallDeltas(
      [],
      [
        { id: 'a', function: { name: 'web_search', arguments: '{}' } },
        { index: 1, id: 'b', function: { name: 'other', arguments: '{}' } },
      ]
    )

    expect(calls).toHaveLength(2)
    expect(calls[0].id).toBe('a')
    expect(calls[1].function.name).toBe('other')
  })
})

describe('extractWebSearchCall', () => {
  it('returns the trimmed query of the first web_search call', () => {
    const extracted = extractWebSearchCall([
      {
        id: 'x',
        type: 'function',
        function: { name: 'other_tool', arguments: '{}' },
      },
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'web_search', arguments: '{"query":"  giá vàng  "}' },
      },
    ])

    expect(extracted).toEqual({
      call: {
        id: 'call_1',
        type: 'function',
        function: { name: 'web_search', arguments: '{"query":"  giá vàng  "}' },
      },
      query: 'giá vàng',
    })
  })

  it('clamps oversized queries to the backend rune limit', () => {
    const huge = 'q'.repeat(MAX_WEB_SEARCH_QUERY_CHARS + 100)
    const extracted = extractWebSearchCall([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'web_search', arguments: `{"query":"${huge}"}` },
      },
    ])

    expect(extracted?.query).toHaveLength(MAX_WEB_SEARCH_QUERY_CHARS)
  })

  it('assigns a fallback id when the provider omitted one', () => {
    const extracted = extractWebSearchCall([
      {
        id: '',
        type: 'function',
        function: { name: 'web_search', arguments: '{"query":"news"}' },
      },
    ])

    expect(extracted?.call.id).toBe('web_search_call')
  })

  it('rejects malformed arguments, empty queries, and foreign tools', () => {
    expect(
      extractWebSearchCall([
        {
          id: 'a',
          type: 'function',
          function: { name: 'web_search', arguments: '{"query":' },
        },
      ])
    ).toBeNull()
    expect(
      extractWebSearchCall([
        {
          id: 'b',
          type: 'function',
          function: { name: 'web_search', arguments: '{"query":"   "}' },
        },
      ])
    ).toBeNull()
    expect(
      extractWebSearchCall([
        {
          id: 'c',
          type: 'function',
          function: { name: 'lookup', arguments: '{"query":"x"}' },
        },
      ])
    ).toBeNull()
  })
})

describe('buildWebSearchFollowupMessages', () => {
  it('pairs the assistant tool call with a tool result message', () => {
    const call = {
      id: 'call_1',
      type: 'function' as const,
      function: { name: 'web_search', arguments: '{"query":"news"}' },
    }

    expect(buildWebSearchFollowupMessages(call, 'Search answer.')).toEqual([
      { role: 'assistant', content: '', tool_calls: [call] },
      { role: 'tool', content: 'Search answer.', tool_call_id: 'call_1' },
    ])
  })

  it('echoes the streamed preamble back as the assistant content', () => {
    const call = {
      id: 'call_1',
      type: 'function' as const,
      function: { name: 'web_search', arguments: '{"query":"news"}' },
    }

    expect(
      buildWebSearchFollowupMessages(call, 'Result.', 'Let me check.')[0]
    ).toEqual({
      role: 'assistant',
      content: 'Let me check.',
      tool_calls: [call],
    })
  })
})
