---
title: Tạo và quản lý API key
summary: Tạo key, đặt giới hạn, sao chép secret một lần và chỉ dùng từ máy chủ tin cậy.
section: console
order: 10
audience: [user, developer]
updated: 2026-08-04
status: published
---

## Điều kiện trước

- Đã đăng nhập tài khoản BoxAI
- Có quyền quản lý key cho workspace

## Tạo key

![API Keys empty state](/doc-assets/screenshots/console/api-keys-empty.en.webp '1. Open Console → API Keys')

![Create API key dialog](/doc-assets/screenshots/console/api-keys-create.en.webp '2. Click Create and name the key')

![API key secret shown once](/doc-assets/screenshots/console/api-keys-created.en.webp '3. Copy the secret immediately — it is shown only once')

:::steps

1. Mở **API Keys** trong console ([/keys](/keys)).
2. Chọn **Create** và đặt tên rõ ràng (ví dụ `prod-server`).
3. Đặt giới hạn tùy chọn nếu có (quota, IP, phạm vi model).
4. Xác nhận tạo và **sao chép secret ngay** — secret chỉ hiện một lần.
   :::

Lưu secret trong biến môi trường máy chủ `BOXAI_API_KEY` (hoặc secret manager). Không commit vào git.

## Dùng key

Hầu hết route OpenAI-compatible cần:

```http
Authorization: Bearer $BOXAI_API_KEY
```

Một số profile (ví dụ Claude Messages) dùng `x-api-key`. Xem trang tương ứng trong [API](/docs/api/overview).

## Xoay vòng hoặc thu hồi

- Xoay khi key có thể đã lộ, thành viên rời nhóm, hoặc client ngừng dùng.
- Thu hồi key không dùng thay vì để secret sống lâu.
- Sau khi xoay, cập nhật mọi máy chủ còn giữ giá trị cũ trước khi thu hồi.

## Bảo mật

:::callout type="warning"
Không đặt API key trong bundle trình duyệt, app di động, repo công khai, ảnh chụp màn hình hoặc ticket hỗ trợ. Nếu lộ, thu hồi và tạo key mới.
:::

## Kiểm tra thành công

- Bạn thấy key trong **/keys** (secret đã ẩn).
- Gọi thử với secret trả **200** (xem [Request đầu tiên](/docs/start/first-request)).

## Tiếp theo

- [Request đầu tiên](/docs/start/first-request)
- [Xác thực API](/docs/api/auth)
- [Nhật ký sử dụng](/docs/console/usage-logs)
