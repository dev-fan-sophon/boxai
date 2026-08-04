---
title: Streaming
summary: Xử lý server-sent events tăng dần và hủy request bị gián đoạn một cách an toàn.
section: api
order: 30
audience: [developer]
updated: 2026-08-04
status: published
---

## Server-sent events

Với endpoint HTTP OpenAI-compatible, bật streaming trong payload và đọc từng khung SSE khi tới. Khung data chứa `[DONE]` kết thúc stream.

Đừng giả định mọi protocol dùng cùng hình dạng sự kiện. OpenAI-compatible, Claude và Gemini có chunk và sự kiện kết thúc riêng. Xem trang protocol tương ứng trong sidebar.

## Hủy và dọn dẹp

Dùng `AbortController` để hủy fetch khi người dùng rời trang, dừng sinh, hoặc hết hạn. Ngừng parse, nhả reader, và phân biệt abort chủ động với lỗi mạng.

```typescript
const controller = new AbortController()
const response = await fetch(url, { ...options, signal: controller.signal })
// Later: controller.abort()
```

## Tiếp theo

- [Lỗi, retry và rate limit](/docs/api/errors)
- [Tổng quan API](/docs/api/overview)
