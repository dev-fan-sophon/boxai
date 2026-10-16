---
title: Tạo ảnh
summary: Tạo và chỉnh sửa ảnh với các model GPT Image, Grok Imagine, Seedream và Gemini image.
section: api
order: 74
audience: [developer]
updated: 2026-10-16
status: published
---

## Yêu cầu

Tạo ảnh là một lời gọi OpenAI Images trên cùng key với mọi endpoint khác:

```text
POST https://you-box.com/v1/images/generations
Authorization: Bearer <BOXAI_API_KEY>
```

```json
{
  "model": "seedream-5.0",
  "prompt": "Poster du lịch tối giản về bãi biển lúc bình minh, minh hoạ phẳng",
  "aspect_ratio": "16:9",
  "resolution": "2k",
  "n": 1
}
```

Ảnh trả về trong `data[]`, mỗi mục có `url` hoặc `b64_json`. Gửi ảnh tham chiếu để chỉnh sửa bằng
`POST /v1/images/edits` (multipart), hoặc truyền `image` (một ảnh) và `images` (nhiều ảnh) ngay
trong lời gọi tạo ảnh — đây là cách Studio gửi.

## Tuỳ chọn theo model

Mọi model dùng chung hình dạng OpenAI; mỗi nhóm model chỉ đọc các tuỳ chọn nó hiểu, phần còn lại
bị gateway từ chối bằng lỗi 400 trước khi gọi upstream.

| Nhóm         | Model                                                          | Điều khiển kích thước                                                                                                                                            | Tuỳ chọn khác                                                                                        |
| ------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Seedream     | `seedream-5.0`                                                 | `aspect_ratio` (hoặc `size` theo upstream) — `auto`, `1:1`, `3:2`, `2:3`, `4:3`, `3:4`, `5:4`, `4:5`, `16:9`, `9:16`, `2:1`, `1:2`, `3:1`, `1:3`, `21:9`, `9:21` | `resolution` `1k`/`2k`, `n` 1–4, tối đa 10 ảnh tham chiếu                                            |
| Gemini image | `gemini-nano-banana-2.1`, `gemini-3.1-flash-image`             | `aspect_ratio` — mười tỷ lệ tiêu chuẩn cùng `4:1`, `1:4`, `8:1`, `1:8`                                                                                           | `resolution` `1K`/`2K`/`4K`, `quality` = mức suy nghĩ `minimal`/`medium`/`high`, mỗi lần gọi một ảnh |
| GPT Image    | `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst`, `gpt-image-2` | `size` dạng `RỘNGxCAO`                                                                                                                                           | `quality`, `background`, `output_format`, `n`                                                        |
| Grok Imagine | `grok-imagine-image-2.0`                                       | `aspect_ratio`                                                                                                                                                   | `resolution` `1k`/`2k`, `quality`, tối đa năm ảnh tham chiếu                                         |

`GET /api/playground/image-capabilities?model=<model>&group=<group>` trả về chính hợp đồng này
dưới dạng JSON (nhóm model, kiểu kích thước, danh sách size/tỷ lệ/độ phân giải/chất lượng,
`maxN`, `maxReferenceImages`, giá trị mặc định) — đó là cách Studio dựng các ô điều khiển.

## Tính phí

Lời gọi tạo ảnh được tính theo từng ảnh thực nhận với mức giá cố định của model, nên nếu kết quả
trả về ít hơn `n`, phí quyết toán xuống đúng số ảnh nhận được. Các model tính theo token thì tính
theo usage mà upstream báo về.

## Lưu ý

- `n` bị giới hạn theo từng nhóm model (Seedream 4, Gemini image 1, GPT Image và Grok Imagine 10);
  giá trị lớn hơn bị từ chối bằng 400 thay vì tự động giảm.
- Ảnh tham chiếu nhận URL công khai hoặc URL `data:image/...;base64,...` đầy đủ.
- Với video, xem [Tạo video](/docs/api/video-generation).
