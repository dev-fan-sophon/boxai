---
title: Tạo video (Seedance)
summary: Gửi, theo dõi và tải tác vụ video Seedance, gồm ảnh/video/audio tham chiếu và khung đầu–cuối.
section: api
order: 60
audience: [developer]
updated: 2026-10-16
status: published
---

## Model

| Model ID                | Thời lượng | Độ phân giải | Ảnh / video / audio tham chiếu |
| ----------------------- | ---------- | ------------ | ------------------------------ |
| `dreamina-seedance-2-5` | 4–30 s     | 720p, 1080p  | 30 / 10 / 10                   |
| `seedance-2-0`          | 4–15 s     | 720p, 1080p  | 9 / 3 / 3                      |
| `seedance-2-0-fast`     | 4–15 s     | 720p         | 9 / 3 / 3                      |
| `seedance-2-0-mini`     | 4–15 s     | 720p         | 9 / 3 / 3                      |

Với Seedance 2.5, audio có thể được tham chiếu độc lập; với dòng 2.0, audio tham chiếu cần đi kèm ảnh hoặc video.

## Gửi tác vụ

```bash
curl https://you-box.com/v1/videos \
  -H "Authorization: Bearer $BOXAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "dreamina-seedance-2-5",
    "prompt": "một quả táo đỏ trên bàn gỗ, đẩy máy chậm, ánh sáng ấm",
    "duration": 5,
    "size": "1280x720"
  }'
```

```json
{
  "id": "task_yOhzcO8t7r1SKaJDnLyjPCWt9CKtNm2u",
  "object": "video",
  "model": "dreamina-seedance-2-5",
  "status": "queued",
  "progress": 0,
  "created_at": 1792163473
}
```

`HTTP 200` nghĩa là tác vụ đã được nhận, chưa có video. Hãy giữ lại `id`.

### Tham số

| Field                        | Kiểu            | Ghi chú                                                                |
| ---------------------------- | --------------- | ---------------------------------------------------------------------- |
| `model`                      | string          | Một trong các model ID ở trên                                          |
| `prompt`                     | string          | Bắt buộc. Mô tả bối cảnh, chuyển động, góc máy, ánh sáng               |
| `duration` / `seconds`       | integer         | Số giây đầu ra; theo khoảng của từng model                             |
| `size`                       | string          | `1280x720`, `720x1280`, `1920x1080`, hoặc dùng `metadata.ratio`        |
| `metadata.ratio`             | string          | `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `21:9`                            |
| `metadata.resolution`        | string          | `720p` hoặc `1080p`; mặc định theo `size`                              |
| `metadata.generate_audio`    | boolean         | Âm thanh đồng bộ gốc (mặc định bật)                                    |
| `metadata.seed`              | integer         | Tạo lại kết quả ổn định                                                |
| `metadata.watermark`         | boolean         | Watermark của nhà cung cấp                                             |
| `image` / `images`           | string \| array | Ảnh thành video: khung đầu (tối đa 9 ảnh với 2.0, 30 với 2.5)          |
| `first_frame` / `last_frame` | string          | Sinh theo khung; với Seedance 2.5 phải dùng `metadata.ratio: adaptive` |
| `reference_images`           | array           | Ảnh tham chiếu, gọi bằng `@Image1`, `@Image2`, …                       |
| `reference_videos`           | array           | Video tham chiếu, gọi bằng `@Video1`, …                                |
| `reference_audios`           | array           | Audio tham chiếu, gọi bằng `@Audio1`, …                                |

Media có thể là URL HTTPS công khai hoặc handle `file-<id>` từ [Tệp và tham chiếu media](/docs/api/files). Media tham chiếu và khung đầu/cuối loại trừ nhau. Không nhúng base64: body vượt 64 MB sẽ bị trả `413` trước khi gọi nhà cung cấp.

## Theo dõi và tải về

```bash
curl https://you-box.com/v1/videos/task_yOhzcO8t7r1SKaJDnLyjPCWt9CKtNm2u \
  -H "Authorization: Bearer $BOXAI_API_KEY"

curl -L https://you-box.com/v1/videos/task_yOhzcO8t7r1SKaJDnLyjPCWt9CKtNm2u/content \
  -H "Authorization: Bearer $BOXAI_API_KEY" -o clip.mp4
```

Nên hỏi trạng thái mỗi 5–15 giây. Clip 720p dài 5 giây thường mất 3–7 phút; trạng thái đi từ `queued` → `in_progress` → `completed`, tác vụ lỗi trả `error.message`. Luôn tải tệp hoàn thành về và kiểm tra lại thời lượng, độ phân giải thực tế. Sau khi timeout, hãy hỏi lại đúng `id` đó — không gửi lại tác vụ đã có.

## Lỗi

| Mã            | Ý nghĩa                                                          | Cách xử lý                                                   |
| ------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| `400`         | Tham số sai, tổ hợp không hỗ trợ, hoặc `file-<id>` không tồn tại | Sửa yêu cầu; chưa bị trừ phí                                 |
| `401` / `403` | Thiếu key, tài khoản bị khoá, hoặc hết quota                     | Kiểm tra key và số dư                                        |
| `413`         | Body quá lớn                                                     | Gửi media dạng URL hoặc file handle, không base64            |
| `429`         | Bị giới hạn tần suất                                             | Chờ và thử lại với backoff                                   |
| `502`         | Nhà cung cấp từ chối nhận tác vụ                                 | Thử lại với backoff; gateway đã tự thử lại trước khi trả lỗi |

Tính phí theo token video đã tạo và quyết toán khi tác vụ xong; tác vụ lỗi được hoàn tiền. Xem thêm [Lỗi, thử lại và giới hạn tần suất](/docs/api/errors).
