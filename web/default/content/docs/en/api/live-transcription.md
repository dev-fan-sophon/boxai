---
title: Live transcription
summary: Stream PCM audio over a WebSocket and receive incremental transcripts from gpt-live-transcribe.
section: api
order: 70
audience: [developer]
updated: 2026-10-16
status: published
---

## Session

Live transcription is a WebSocket session, not a REST call:

```text
wss://you-box.com/v1/realtime?intent=transcription&model=gpt-live-transcribe
Authorization: Bearer <BOXAI_API_KEY>
```

Clients that prefer the OpenAI convention can send the key as a subprotocol instead:
`Sec-WebSocket-Protocol: realtime, openai-insecure-api-key.<BOXAI_API_KEY>`.

The gateway answers with `session.created`, then `session.updated` for every accepted configuration:

```json
{
  "type": "session.created",
  "session": {
    "type": "transcription",
    "audio": {
      "input": {
        "format": { "type": "audio/pcm", "rate": 24000 },
        "transcription": { "model": "gpt-live-transcribe" },
        "turn_detection": null
      }
    }
  }
}
```

## Audio and turns

Audio is **PCM16 mono at 24 kHz**, base64-encoded, appended in chunks. Turns are committed manually — there is no server-side voice detection:

| Event                       | Meaning                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `session.update`            | Optional, once, before audio: `transcription.prompt`, `keywords`, `languages`, `delay` (`minimal`/`low`/`medium`/`high`/`xhigh`) |
| `input_audio_buffer.append` | `audio` — base64 PCM16 chunk of the current turn                                                                                 |
| `input_audio_buffer.commit` | Ends the turn and starts transcription                                                                                           |

A turn may hold at most **60 seconds** of audio and only one turn is in flight: commit, read the result, then append the next turn. Append, commit, and the transcript all refer to one item.

## Transcript events

```json
{ "type": "input_audio_buffer.committed", "item_id": "item_abc" }
{ "type": "conversation.item.input_audio_transcription.delta", "item_id": "item_abc", "content_index": 0, "delta": "hel" }
{ "type": "conversation.item.input_audio_transcription.completed", "item_id": "item_abc", "content_index": 0, "transcript": "hello", "usage": { "type": "duration", "seconds": 2.4 } }
```

Only these events plus `session.created`/`session.updated` are forwarded. Anything else — an unknown event, a second commit, audio beyond the turn limit — closes the session with a policy-violation status instead of being silently ignored.

## Billing

Audio is billed per second of committed input at the model's token ratio, settled when the upstream reports `usage.duration` for the turn. A session that fails before settlement reserves nothing extra; see [Errors, retries, and rate limits](/docs/api/errors) for the gateway-wide contract.

## Notes

- Keep the socket open across turns: connect once, then commit turn after turn.
- Send `input_audio_buffer.commit` only after at least ~0.1 s of audio; empty turns are rejected.
- For file-based transcription use `POST /v1/audio/transcriptions` with `gpt-transcribe`.
