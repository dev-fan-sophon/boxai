---
title: Tổng quan API
summary: Một base URL gateway, nhiều protocol profile, và model ID lấy từ Model Hub.
section: api
order: 10
audience: [developer]
updated: 2026-08-04
status: published
---

## Base URL
![Sign-in to BoxAI](/doc-assets/screenshots/auth/sign-in.en.webp "Create an account or sign in before issuing API keys")


Host production:

```text
https://you-box.com
```

Ví dụ path chat OpenAI-compatible:

```text
https://you-box.com/v1/chat/completions
```

Luôn gọi **BoxAI**, không gọi URL upstream, khi bạn muốn dùng key và billing của BoxAI.

## Protocol profile

BoxAI cung cấp nhiều profile tích hợp (OpenAI Chat, Responses, Claude Messages, Gemini, embeddings, images, audio, …). Mỗi profile mô tả:

- Method HTTP và path template trên gateway
- Scheme header xác thực
- Hỗ trợ streaming
- Mẫu sao chép sẵn (cURL, Python, TypeScript, JavaScript)

Duyệt các trang protocol trong mục **API** ở sidebar. Chúng được tạo từ catalog tích hợp thực tế.

## Model ID

Dùng đúng ID từ [Model Hub](/pricing). Khả dụng có thể phụ thuộc group.

## Tài liệu liên quan

- [Xác thực](/docs/api/auth)
- [Streaming](/docs/api/streaming)
- [Lỗi và rate limit](/docs/api/errors)
- [Bắt đầu](/docs/start/getting-started)
