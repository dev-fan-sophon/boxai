---
title: Giọng nói thời gian thực
summary: Nói chuyện với gpt-realtime-2.1 qua WebSocket và nhận câu trả lời dạng giọng nói.
section: api
order: 72
audience: [developer]
updated: 2026-10-16
status: published
---

## Phiên

Giọng nói thời gian thực là một phiên WebSocket hai chiều: audio đi cả hai hướng trên cùng một socket.

```text
wss://you-box.com/v1/realtime?model=gpt-realtime-2.1
Authorization: Bearer <BOXAI_API_KEY>
```

Client theo chuẩn OpenAI có thể gửi key qua subprotocol:
`Sec-WebSocket-Protocol: realtime, openai-insecure-api-key.<BOXAI_API_KEY>`.

Gateway trả `session.created`. Cấu hình phiên một lần bằng `session.update`:

```json
{
  "type": "session.update",
  "session": {
    "type": "realtime",
    "instructions": "Bạn là trợ lý giọng nói hữu ích.",
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

Đặt `output_modalities` thành `["text"]` nếu chỉ cần trợ lý trả lời bằng văn bản. Mọi cấu
hình không được chấp nhận sẽ trả về event `error` trên chính socket đó.

## Audio và lượt

Audio là **PCM16 mono 24 kHz**, mã hoá base64, gửi theo từng khối:

| Event                       | Ý nghĩa                                                       |
| --------------------------- | ------------------------------------------------------------- |
| `input_audio_buffer.append` | `audio` — khối PCM16 base64 của lượt hiện tại                 |
| `input_audio_buffer.commit` | Kết thúc lượt để model trả lời                                |
| `response.create`           | Yêu cầu một câu trả lời (bỏ qua nếu để server VAD điều khiển) |
| `response.cancel`           | Ngắt câu trả lời đang được tạo                                |

Khi để `turn_detection` ở mặc định, server tự phát hiện kết thúc giọng nói và bắt đầu trả
lời; hãy commit thủ công nếu client tự phát hiện giọng nói. Kết quả của model đến dưới dạng
`response.output_audio.delta` (PCM16 base64) kèm văn bản
`response.output_audio_transcript.delta`, và mỗi lượt kết thúc bằng `response.done`.

## Trạng thái hội thoại

Server giữ hội thoại, nên các lượt tiếp theo chỉ cần gửi audio mới:

| Event                        | Ý nghĩa                                                                    |
| ---------------------------- | -------------------------------------------------------------------------- |
| `conversation.item.create`   | Thêm tin nhắn văn bản hoặc kết quả tool vào hội thoại                      |
| `conversation.item.truncate` | Cắt ngắn câu trả lời đã phát để trạng thái của model khớp với phần đã nghe |
| `session.update`             | Đổi instructions, voice, tools hoặc format giữa phiên                      |

Tool call đến dưới dạng `response.function_call_arguments.done`; trả lời bằng
`conversation.item.create` kiểu `function_call_output` rồi gửi `response.create`.

## Tính phí

Mỗi lượt được tính theo token usage mà upstream báo về, tách thành văn bản và audio: audio là
1666,67 token đầu vào mỗi phút và 833,33 token đầu ra mỗi phút, tính theo tỷ lệ audio của
model. Phí được quyết toán khi `response.done` đến, và object `usage` trong event đó cho biết
số token đã tính cho lượt.

## Lưu ý

- Giữ một socket cho mỗi hội thoại; chỉ kết nối lại khi bắt đầu hội thoại mới.
- Phiên realtime có trạng thái — gửi lại `session.update` sau khi kết nối lại.
- Nếu chỉ cần chuyển giọng nói thành văn bản, dùng [Phiên âm trực tiếp](/docs/api/live-transcription);
  nếu cần trả lời một lần, dùng `POST /v1/chat/completions`.
