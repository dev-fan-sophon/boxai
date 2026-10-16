---
title: Phiên âm trực tiếp
summary: Truyền audio PCM qua WebSocket và nhận bản phiên âm tăng dần từ gpt-live-transcribe.
section: api
order: 70
audience: [developer]
updated: 2026-10-16
status: published
---

## Phiên

Phiên âm trực tiếp là một phiên WebSocket, không phải REST:

```text
wss://you-box.com/v1/realtime?intent=transcription&model=gpt-live-transcribe
Authorization: Bearer <BOXAI_API_KEY>
```

Client theo chuẩn OpenAI có thể gửi key qua subprotocol:
`Sec-WebSocket-Protocol: realtime, openai-insecure-api-key.<BOXAI_API_KEY>`.

Gateway trả `session.created`, sau đó `session.updated` cho mỗi cấu hình được chấp nhận:

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

## Audio và lượt

Audio là **PCM16 mono 24 kHz**, mã hoá base64, gửi theo từng khối. Lượt được commit thủ công — không có phát hiện giọng nói phía server:

| Event                       | Ý nghĩa                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `session.update`            | Tuỳ chọn, một lần, trước khi gửi audio: `transcription.prompt`, `keywords`, `languages`, `delay` (`minimal`/`low`/`medium`/`high`/`xhigh`) |
| `input_audio_buffer.append` | `audio` — khối PCM16 base64 của lượt hiện tại                                                                                              |
| `input_audio_buffer.commit` | Kết thúc lượt và bắt đầu phiên âm                                                                                                          |

Mỗi lượt tối đa **60 giây** audio và chỉ một lượt được xử lý tại một thời điểm: commit, đọc kết quả, rồi gửi lượt tiếp theo. Append, commit và bản phiên âm cùng trỏ tới một item.

## Event phiên âm

```json
{ "type": "input_audio_buffer.committed", "item_id": "item_abc" }
{ "type": "conversation.item.input_audio_transcription.delta", "item_id": "item_abc", "content_index": 0, "delta": "hel" }
{ "type": "conversation.item.input_audio_transcription.completed", "item_id": "item_abc", "content_index": 0, "transcript": "hello", "usage": { "type": "duration", "seconds": 2.4 } }
```

Chỉ các event này cùng `session.created`/`session.updated` được chuyển tiếp. Mọi thứ khác — event không xác định, commit lần hai, audio vượt giới hạn lượt — sẽ đóng phiên với trạng thái vi phạm chính sách thay vì bị bỏ qua âm thầm.

## Tính phí

Audio được tính theo giây đầu vào đã commit theo tỷ lệ token của model, quyết toán khi upstream trả `usage.duration` cho lượt đó. Phiên lỗi trước khi quyết toán không giữ thêm phí; xem [Lỗi, thử lại và giới hạn tần suất](/docs/api/errors).

## Lưu ý

- Giữ socket mở qua nhiều lượt: kết nối một lần rồi commit liên tiếp.
- Chỉ gửi `input_audio_buffer.commit` sau khi đã có ít nhất ~0,1 giây audio; lượt rỗng bị từ chối.
- Với phiên âm từ tệp, dùng `POST /v1/audio/transcriptions` với `gpt-transcribe`.
