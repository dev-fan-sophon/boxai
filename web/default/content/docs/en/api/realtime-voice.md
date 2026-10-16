---
title: Realtime voice
summary: Speak with gpt-realtime-2.1 over a WebSocket and get spoken answers back.
section: api
order: 72
audience: [developer]
updated: 2026-10-16
status: published
---

## Session

Realtime voice is a duplex WebSocket session: audio flows both ways on one socket.

```text
wss://you-box.com/v1/realtime?model=gpt-realtime-2.1
Authorization: Bearer <BOXAI_API_KEY>
```

Clients that prefer the OpenAI convention can send the key as a subprotocol instead:
`Sec-WebSocket-Protocol: realtime, openai-insecure-api-key.<BOXAI_API_KEY>`.

The gateway answers with `session.created`. Configure the session once with `session.update`:

```json
{
  "type": "session.update",
  "session": {
    "type": "realtime",
    "instructions": "You are a helpful voice assistant.",
    "output_modalities": ["audio"],
    "audio": {
      "input": { "format": { "type": "audio/pcm", "rate": 24000 } },
      "output": {
        "format": { "type": "audio/pcm", "rate": 24000 },
        "voice": "alloy"
      }
    }
  }
}
```

Set `output_modalities` to `["text"]` for a text-only assistant. Anything the session
does not accept is reported as an `error` event on the same socket.

## Audio and turns

Audio is **PCM16 mono at 24 kHz**, base64-encoded, appended in chunks:

| Event                       | Meaning                                                     |
| --------------------------- | ----------------------------------------------------------- |
| `input_audio_buffer.append` | `audio` — base64 PCM16 chunk of the current turn            |
| `input_audio_buffer.commit` | Ends the turn so the model can answer                       |
| `response.create`           | Asks for a response (omit it to let server VAD drive turns) |
| `response.cancel`           | Interrupts the response that is being generated             |

With `turn_detection` left at its default, the server detects the end of speech itself and
starts a response; commit manually when your client does its own voice detection. Model
output arrives as `response.output_audio.delta` (base64 PCM16) plus
`response.output_audio_transcript.delta` text, and each turn closes with `response.done`.

## Conversation state

The server keeps the conversation, so follow-up turns only send new audio:

| Event                        | Meaning                                                                |
| ---------------------------- | ---------------------------------------------------------------------- |
| `conversation.item.create`   | Adds a text message or a tool result to the conversation               |
| `conversation.item.truncate` | Cuts a played answer short so the model's state matches what was heard |
| `session.update`             | Changes instructions, voice, tools, or formats mid-session             |

Tool calls arrive as `response.function_call_arguments.done`; answer them with a
`conversation.item.create` of type `function_call_output` followed by `response.create`.

## Billing

A realtime turn is billed from the token usage the upstream reports for it, split into
text and audio: audio is 1666.67 input tokens per minute and 833.33 output tokens per
minute, charged at the model's audio ratio. The usage is settled when `response.done`
arrives, and the `usage` object in that event shows the tokens charged for the turn.

## Notes

- Keep one socket per conversation; reconnect only to start a new one.
- Realtime sessions are stateful — re-send `session.update` after a reconnect.
- For speech-to-text only, use [Live transcription](/docs/api/live-transcription); for
  one-shot answers use `POST /v1/chat/completions`.
