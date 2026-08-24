---
title: Request đầu tiên
summary: Gửi chat completion thành công từ Playground hoặc curl, rồi xác nhận usage.
section: start
order: 30
audience: [user, developer]
updated: 2026-08-04
status: published
checklist:
  [
    Mở Playground hoặc chuẩn bị curl,
    Chọn mô hình,
    Gửi Hello,
    Xác nhận 200 hoặc phản hồi,
  ]
---

## Mục tiêu

Hoàn thành một lần gọi mô hình thành công để biết billing, key và định tuyến hoạt động end-to-end.

## Cách A — Playground (nhanh nhất)

![Playground successful chat](/doc-assets/screenshots/playground/chat-success.en.webp '1. Open Playground → pick a model → send Hello')

:::steps

1. Đăng nhập và mở [Playground](/playground).
2. Chọn mô hình mà nhóm bạn được phép dùng (cùng ID với [Model Hub](/pricing)).
3. Gửi tin nhắn ngắn như `Hello`.
4. Xác nhận có phản hồi trợ lý và không có banner lỗi.
   :::

## Cách B — API (dạng production)

1. Tạo key trong [API Keys](/docs/console/api-keys) và export thành `BOXAI_API_KEY`.
2. Sao chép đúng model ID từ Model Hub (không tự đặt alias).
3. Chạy:

```bash
curl "https://you-box.com/v1/chat/completions" \
  -H "Authorization: Bearer $BOXAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"YOUR_MODEL_ID","messages":[{"role":"user","content":"Hello"}]}'
```

## Kiểm tra thành công

| Kiểm tra    | Kỳ vọng                                                       |
| ----------- | ------------------------------------------------------------- |
| HTTP status | `200`                                                         |
| Body        | Có output mô hình (`choices` với chat OpenAI-compatible)      |
| Console     | Có dòng mới trong [Nhật ký sử dụng](/docs/console/usage-logs) |

## Lỗi thường gặp

| Hiện tượng            | Cách xử lý                                                               |
| --------------------- | ------------------------------------------------------------------------ |
| `401` / `403`         | Kiểm tra key, header Authorization và quyền model của nhóm               |
| `400` / `422`         | Sửa JSON hoặc model ID; không retry nguyên trạng                         |
| `429`                 | Giảm tốc; xem [Lỗi và giới hạn](/docs/api/errors#http-status-categories) |
| Danh sách model trống | Kiểm tra quyền nhóm hoặc nạp hạn mức                                     |

## Tiếp theo

- [Streaming](/docs/api/streaming)
- [Lỗi, retry và rate limit](/docs/api/errors)
- [Xác thực API](/docs/api/auth)
