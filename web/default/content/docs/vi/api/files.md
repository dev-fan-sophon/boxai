---
title: Tệp và tham chiếu media
summary: Tải ảnh, video và audio của bạn lên một lần, rồi tham chiếu bằng file id trong mọi yêu cầu tạo nội dung.
section: api
order: 50
audience: [developer]
updated: 2026-10-16
status: published
---

## Vì sao nên tải lên thay vì nhúng trực tiếp

Yêu cầu tạo nội dung nhận media dưới dạng URL HTTPS công khai hoặc handle `file-<id>` của API này. Gửi bytes **bên trong** JSON (URL `data:` base64) chính là nguyên nhân làm request vượt giới hạn body của upstream: nhà cung cấp video từ chối body lớn hơn 64 MB bằng lỗi `413`, và bên bán lại có thể báo thành lỗi gateway chung. Hãy tải lên một lần, rồi truyền handle.

Handle thuộc sở hữu của tài khoản: chỉ user của API key mới đọc, tải hoặc xoá được.

## Tải tệp lên

```bash
curl https://you-box.com/v1/files \
  -H "Authorization: Bearer $BOXAI_API_KEY" \
  -F purpose=vision \
  -F file=@first-frame.png
```

```json
{
  "id": "file-1234",
  "object": "file",
  "bytes": 204800,
  "created_at": 1792163930,
  "filename": "first-frame.png",
  "purpose": "vision"
}
```

Bắt buộc dùng `multipart/form-data` với field `file`. `purpose` được nhận để tương thích OpenAI; purpose trả về suy ra từ kiểu nội dung đã nhận diện (`vision` cho ảnh, `video`, `audio`, `user_data` cho tài liệu). MIME khai báo chỉ là gợi ý — nội dung được nhận diện thực tế, kiểu không hỗ trợ sẽ bị trả `400`.

Giới hạn dung lượng theo loại:

| Loại | Giới hạn |
|------|----------|
| ảnh | 10 MB |
| video | 200 MB |
| audio | 20 MB |
| tài liệu | 20 MB |

## Dùng tệp trong yêu cầu

Truyền handle ở bất kỳ chỗ nào nhận URL media — gateway sẽ tự thay bằng URL ngắn hạn mà nhà cung cấp đọc được:

```bash
curl https://you-box.com/v1/videos \
  -H "Authorization: Bearer $BOXAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "dreamina-seedance-2-5",
    "prompt": "đẩy máy chậm vào @Image1, giữ nguyên chủ thể",
    "duration": 5,
    "size": "1280x720",
    "first_frame": "file-1234"
  }'
```

Hỗ trợ trên yêu cầu video (`/v1/videos`, `/v1/videos/text2video`, `/v1/videos/image2video`, `/v1/videos/{id}/remix`) cho `image`/`images`, `first_frame`, `last_frame`, `input_reference`, `reference_images`, `reference_videos`, `reference_audios`, và trên yêu cầu ảnh (`/v1/images/generations`, `/v1/images/edits`) cho `image`, `images`, `mask`. Handle không tồn tại hoặc thuộc tài khoản khác sẽ trả `400` trước khi trừ quota.

## Truy vấn, liệt kê, tải về, xoá

```bash
curl https://you-box.com/v1/files/file-1234          -H "Authorization: Bearer $BOXAI_API_KEY"
curl "https://you-box.com/v1/files?limit=50"         -H "Authorization: Bearer $BOXAI_API_KEY"
curl https://you-box.com/v1/files/file-1234/content  -H "Authorization: Bearer $BOXAI_API_KEY" -o media.bin
curl -X DELETE https://you-box.com/v1/files/file-1234 -H "Authorization: Bearer $BOXAI_API_KEY"
```

Xoá tệp sẽ xoá cả bản ghi và object đã lưu; phản hồi là `{"id": "file-1234", "object": "file", "deleted": true}`.

## Lưu trữ và thời hạn

Tệp nằm trong object storage của BoxAI chừng nào tài khoản còn giữ, không phải 24 giờ: handle luôn hợp lệ, và gateway tạo URL mới cho nhà cung cấp ở mỗi yêu cầu. Tham chiếu được gửi dưới dạng liên kết có chữ ký, nên tệp của bạn không bị công khai.
