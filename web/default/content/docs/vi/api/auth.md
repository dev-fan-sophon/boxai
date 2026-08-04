---
title: Xác thực API
summary: Xác thực gọi gateway bằng Bearer key hoặc header theo profile; giữ secret phía máy chủ.
section: api
order: 20
audience: [developer]
updated: 2026-08-04
status: published
---

## Tạo credential

Làm theo [Tạo và quản lý API key](/docs/console/api-keys), rồi lưu secret thành biến môi trường trên máy chủ.

## Header phổ biến

Route OpenAI-compatible:

```http
Authorization: Bearer $BOXAI_API_KEY
Content-Type: application/json
```

## Auth theo profile

Một số profile dùng scheme khác (ví dụ `x-api-key` và header phiên bản cho Claude Messages). Xem trang protocol để biết header chính xác trước khi tích hợp.

## Quy tắc bảo mật

:::callout type="danger"
Không đưa API key vào trình duyệt, app di động hoặc client công khai. Dùng backend làm caller tin cậy. Xoay ngay sau mọi lần lộ.
:::

## Kiểm tra thành công

Gọi không xác thực phải thất bại với **401**. Key hợp lệ trên model được phép trả **200** với payload tối thiểu.

## Tiếp theo

- [Request đầu tiên](/docs/start/first-request)
- [Tổng quan API](/docs/api/overview)
