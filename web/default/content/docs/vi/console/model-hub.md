---
title: Model Hub
summary: Tìm đúng model ID, so sánh giá và khả năng, rồi dùng ID đó trong API.
section: console
order: 20
audience: [user, developer]
updated: 2026-08-04
status: published
---

## Model Hub là gì

[Model Hub](/pricing) là danh mục công khai các mô hình qua BoxAI: giá, modality và gợi ý tích hợp. Luôn sao chép **đúng model ID** trên hub — không tự đặt tên tắt.

## Chọn mô hình

:::steps
1. Mở [Model Hub](/pricing).
2. Lọc theo nhà cung cấp, modality hoặc giá nếu cần.
3. Mở trang chi tiết và sao chép model ID.
4. Xác nhận mô hình khả dụng với **nhóm của bạn** (một số model bị giới hạn theo group).
:::

## Dùng ID trong request

```json
{
  "model": "YOUR_MODEL_ID",
  "messages": [{ "role": "user", "content": "Hello" }]
}
```

Các trang protocol dưới [/docs/api](/docs/api/overview) mô tả khác biệt path/header; model ID vẫn lấy từ Model Hub.

## Kiểm tra thành công

- Chuỗi model ID trong request khớp chính xác với hub.
- Completion thử với key của bạn trả 200.

## Tiếp theo

- [Request đầu tiên](/docs/start/first-request)
- [Model, group và quota](/docs/concepts/models-groups-quota)
