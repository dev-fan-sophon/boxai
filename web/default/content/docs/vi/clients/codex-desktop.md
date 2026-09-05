---
title: Dùng Codex desktop với API BoxAI tùy chỉnh
summary: Cấu hình phiên bản Codex desktop hiện tại bằng config.toml và auth.json, dùng mô hình Responses của BoxAI và xác nhận nơi tính phí.
section: clients
order: 30
audience: [user, developer]
updated: 2026-09-05
status: published
---

## Phiên bản đã kiểm tra

Kiểm tra ngày **05/09/2026** qua [nguồn cập nhật macOS chính thức](https://persistent.oaistatic.com/codex-app-prod/appcast.xml) của OpenAI: **26.901.41600, build 7982**, phát hành lúc **02:13 UTC / 09:13 giờ Việt Nam**. Chúng tôi cũng kiểm tra thông tin phiên bản trong gói tải về và chương trình Codex đi kèm, có chuỗi phiên bản **0.153.4**. Gói hiện tại mang tên `ChatGPT.app`; tài liệu OpenAI hiện gọi đây là Codex trong ứng dụng ChatGPT desktop.

Đây là hướng dẫn theo ngày kiểm tra, không khẳng định phiên bản này luôn mới nhất. Hãy kiểm tra cập nhật và mục About của ứng dụng. Lệnh `codex --version` cài riêng chỉ cho biết phiên bản CLI, **không phải phiên bản desktop**. Các bước Windows dưới đây dùng cùng định dạng cấu hình; chúng tôi chưa xác minh độc lập số build mới nhất trên Windows Store. Việc kiểm tra gói và cấu hình không thay thế thử nghiệm toàn trình trên giao diện macOS hoặc Windows thực tế.

## Chuẩn bị

- Tạo **khóa API gọi mô hình của BoxAI** tại [Khóa API](/keys), có đủ số dư và quyền dùng mô hình. Không dùng token quản trị BoxAI, token phiên ChatGPT hoặc khóa của nhà cung cấp khác.
- Kiểm tra ID chính xác tại [Model Hub](/pricing). Ví dụ dùng `gpt-6-astra`; đổi ID nếu khóa của bạn không được phép dùng mô hình này.
- Hướng dẫn áp dụng cho **tác vụ desktop chạy cục bộ**, tính phí qua BoxAI. Khóa BoxAI không mở quyền dùng tác vụ đám mây ChatGPT hoặc tính năng điều khiển từ xa.
- Thoát hẳn ứng dụng trước khi chỉnh sửa. Sao lưu riêng tư `config.toml` và `auth.json` nếu đã có. CLI và tiện ích IDE dùng chung thư mục Codex cũng có thể bị ảnh hưởng. Giữ nguyên các thiết lập MCP, dự án và an toàn không liên quan.

## 1. Mở thư mục cấu hình người dùng

| Hệ điều hành | Thư mục mặc định                                   |
| ------------ | -------------------------------------------------- |
| macOS        | `~/.codex/` — trong Finder, chọn Go → Go to Folder |
| Windows      | `%USERPROFILE%\.codex\` — dán vào File Explorer    |

Nếu ứng dụng có biến `CODEX_HOME`, dùng thư mục đó. Dùng cấu hình **cấp người dùng**, không phải `.codex/config.toml` trong kho mã: phiên bản hiện tại giới hạn việc ghi đè nhà cung cấp và xác thực từ cấu hình dự án.

Tạo `config.toml` và `auth.json` nếu chưa có. Lưu dưới dạng văn bản thuần, đúng tên file; tránh `config.toml.txt` hoặc `auth.json.txt`.

## 2. Cấu hình config.toml

Đây là cách **đăng nhập API bằng thông tin lưu trong file**. Ghép các thiết lập sau vào cấu hình người dùng. Khóa cấp cao nhất phải nằm **trước mọi tiêu đề `[table]`**; sửa khóa có sẵn thay vì tạo khóa trùng.

```toml
model_provider = "boxai"
model = "gpt-6-astra"
model_reasoning_effort = "high"

# Dùng đăng nhập bằng khóa API, không dùng phiên đăng nhập ChatGPT.
forced_login_method = "api"
# Đọc thông tin xác thực từ auth.json ở bước tiếp theo.
cli_auth_credentials_store = "file"

[model_providers.boxai]
name = "BoxAI"
base_url = "https://you-box.com/v1"
wire_api = "responses"
requires_openai_auth = true
supports_websockets = false
```

**Đừng bỏ sót `forced_login_method = "api"`.** Khóa này ở cấp cao nhất, không nằm trong `[model_providers.boxai]`. Với cách này, nó ngăn dùng phiên ChatGPT hiện có thay cho đăng nhập API. Đây **không phải khóa mới được thêm trong 26.901.41600**: OpenAI đã thêm giới hạn đăng nhập này từ năm 2025. Nó cũng không bắt buộc cho mọi nhà cung cấp tùy chỉnh; cách dùng biến môi trường bên dưới có cơ chế xác thực khác.

| Thiết lập                             | Ý nghĩa                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `model_provider = "boxai"`            | Phải khớp chính xác với phần sau của `[model_providers.boxai]`. Không định nghĩa lại nhà cung cấp dành riêng `openai`.                                 |
| `base_url`                            | Dùng `https://you-box.com/v1`, không dùng `/v1/responses`. Codex tự nối `/responses`.                                                                  |
| `wire_api = "responses"`              | Codex hiện dùng giao thức Responses. Ví dụ cũ có `wire_api = "chat"` không còn được hỗ trợ.                                                            |
| `requires_openai_auth = true`         | Dùng thông tin đăng nhập API của Codex từ `auth.json`. Không chuyển đích gọi sang OpenAI; `base_url` chọn BoxAI. Không kết hợp cách này với `env_key`. |
| `supports_websockets = false`         | Dùng HTTP/SSE thay vì mặc định gateway hỗ trợ Responses WebSocket. Vẫn có thể nhận luồng qua SSE.                                                      |
| `cli_auth_credentials_store = "file"` | Tránh thông tin trong kho khóa hệ điều hành được ưu tiên hơn file vừa sửa. File chứa bí mật dạng văn bản thuần, cần bảo vệ.                            |

`model_reasoning_effort` là tùy chọn theo mô hình. Astra hỗ trợ `low`, `medium`, `high`, `xhigh`, `max`, không hỗ trợ `none`. Không sao chép giới hạn ngữ cảnh hoặc mức suy luận từ mô hình khác. Không thêm thiết lập bỏ qua sandbox: chúng không liên quan đến nhà cung cấp API.

## 3. Cấu hình auth.json

Với cách chỉ dùng API này, lưu đối tượng sau vào cùng thư mục. Thay giá trị mẫu bằng **khóa API BoxAI của bạn**. Không chép access token hoặc refresh token của ChatGPT vào đây.

```json
{
  "auth_mode": "apikey",
  "OPENAI_API_KEY": "REPLACE_WITH_YOUR_BOXAI_API_KEY"
}
```

Phải giữ đúng `auth_mode` là `apikey` và tên trường JSON `OPENAI_API_KEY`. Tên trường thuộc định dạng thông tin xác thực của Codex; giá trị là khóa **BoxAI** dùng với endpoint BoxAI đã cấu hình. JSON không cho phép chú thích hoặc dấu phẩy cuối.

Trên macOS, giới hạn quyền truy cập sau khi lưu:

```bash
chmod 700 ~/.codex
chmod 600 ~/.codex/config.toml ~/.codex/auth.json
```

Trên Windows, lưu file trong hồ sơ người dùng riêng tư và giới hạn quyền đọc cho tài khoản của bạn. Không commit, tải lên, chụp ảnh hoặc chia sẻ `auth.json`. Bảo vệ cả bản sao lưu. Không chạy `codex login` để đăng nhập ChatGPT sau đó, trừ khi bạn chủ động muốn đổi phương thức xác thực.

## 4. Khởi động lại và kiểm tra tác vụ cục bộ mới

1. Thoát hẳn rồi mở lại ứng dụng; chỉ đóng cửa sổ có thể chưa kết thúc tiến trình.
2. Tạo **tác vụ cục bộ mới**. Hội thoại cũ có thể giữ nhà cung cấp và mô hình ban đầu, nên không dùng để kiểm tra thay đổi.
3. Chọn `gpt-6-astra` nếu có trong danh sách và gửi yêu cầu nhỏ như “Reply with OK.” Chỉ có câu trả lời chưa chứng minh nhà cung cấp nào đã xử lý.
4. Mở [Nhật ký sử dụng BoxAI](/console/log), đối chiếu thời gian, tên mô hình, số token và phí của yêu cầu mới. Bản ghi thành công trùng khớp là bằng chứng quyết định BoxAI đã xử lý yêu cầu.
5. Kiểm tra không có yêu cầu ngoài ý muốn trong lịch sử tính phí của nhà cung cấp khác. Không chỉ dựa vào tên mô hình trên giao diện desktop.

Nếu vẫn xuất hiện màn hình đăng nhập, kiểm tra file, `CODEX_HOME` và chế độ API trước. Tài liệu OpenAI hiện gọi lối đăng nhập API là **Sign in another way**. Không chuyển sang đăng nhập ChatGPT chỉ để bỏ qua lỗi nhà cung cấp tùy chỉnh, và không nhập khóa BoxAI vào website không liên quan.

## Cách khác: dùng khóa từ biến môi trường

Dùng cách này **thay cho**, không kết hợp với cách lưu thông tin xác thực trong file, khi bạn có thể cấp biến môi trường cho đúng tiến trình desktop/app-server:

```toml
model_provider = "boxai"
model = "gpt-6-astra"
model_reasoning_effort = "high"

[model_providers.boxai]
name = "BoxAI"
base_url = "https://you-box.com/v1"
wire_api = "responses"
env_key = "BOXAI_API_KEY"
requires_openai_auth = false
supports_websockets = false
```

Thiết lập `BOXAI_API_KEY` an toàn trong môi trường mà tiến trình desktop/app-server kế thừa, rồi khởi động lại hoàn toàn. Chỉ export biến trong terminal không bảo đảm ứng dụng mở từ Finder, Dock hoặc Start menu đọc được biến đó. Cách này không cần khóa BoxAI trong `auth.json`; không xóa thông tin xác thực hiện có nếu không cần thiết. Bỏ giới hạn `forced_login_method` của cách dùng file nếu muốn giữ các tính năng cần đăng nhập ChatGPT. Các tính năng đó có điều kiện riêng; cấu hình này không bảo đảm quyền sử dụng.

## Lỗi thường gặp và hướng dẫn đã cũ

| Hiện tượng                                              | Cần kiểm tra                                                                                                                                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vẫn dùng ChatGPT hoặc nhà cung cấp sai                  | Kiểm tra `model_provider`, `forced_login_method` ở cấp cao nhất, thư mục Codex đang dùng; tạo tác vụ mới và đối chiếu nhật ký BoxAI.                                                    |
| `401` / khóa không hợp lệ                               | Dùng khóa gọi mô hình BoxAI. Với file, kiểm tra `auth_mode`, `OPENAI_API_KEY`, `cli_auth_credentials_store`. Với biến môi trường, kiểm tra tiến trình có biến mà không in giá trị khóa. |
| `404` / endpoint không hỗ trợ                           | Dùng URL gốc kết thúc bằng `/v1` và `wire_api = "responses"`; không tự nối `/responses` hoặc dùng `"chat"`.                                                                             |
| Không có quyền dùng mô hình                             | Kiểm tra ID, nhóm, quyền khóa và số dư BoxAI. Thêm mô hình vào danh mục tùy chỉnh không cấp quyền truy cập.                                                                             |
| Danh sách mô hình thiếu hoặc sai                        | Một số bản desktop có hạn chế với danh sách hoặc định tuyến nhà cung cấp tùy chỉnh. Cập nhật, khởi động lại và tạo tác vụ mới. Không sửa cơ sở dữ liệu SQLite của Codex để ép mô hình.  |
| Cấu hình bị bỏ qua                                      | Kiểm tra khóa TOML trùng, vị trí bảng, `CODEX_HOME`, cấu hình profile/quản trị và việc khởi động lại.                                                                                   |
| Lỗi bắt tay WebSocket                                   | Giữ `supports_websockets = false` nếu chưa xác minh endpoint hỗ trợ WebSocket.                                                                                                          |
| Tính năng đám mây hoặc điều khiển từ xa ngừng hoạt động | Chế độ khóa API không phải xác thực ChatGPT cloud. Khôi phục bản sao lưu riêng tư nếu quay lại ChatGPT; kiểm tra cả nhà cung cấp và thông tin xác thực.                                 |

`model_catalog_json` là danh mục mô hình tùy chỉnh **tùy chọn ở cấp cao nhất**, không phải cờ xác thực mới bắt buộc. Nó thay thế danh mục, dùng schema Codex chứ không phải phản hồi `/v1/models` thô, và không tự sửa lỗi định tuyến desktop. `preferred_auth_method` và `disable_response_storage` không cần cho cấu hình này; không thêm thiết lập từ hướng dẫn cũ nếu chưa kiểm tra schema hiện tại.

## Nguồn và bước tiếp theo

- [Nguồn cập nhật desktop chính thức](https://persistent.oaistatic.com/codex-app-prod/appcast.xml)
- [Tài liệu chính thức về xác thực và nhà cung cấp thay thế](https://developers.openai.com/codex/auth/)
- [Tham chiếu cấu hình chính thức](https://developers.openai.com/codex/config-reference/)
- [Cấu hình nhà cung cấp nâng cao](https://developers.openai.com/codex/config-advanced/)
- [Bản phát hành Codex 0.153.4](https://github.com/openai/codex/releases/tag/rust-v0.153.4) và [thay đổi ban đầu về giới hạn đăng nhập](https://github.com/openai/codex/commit/d87f87e25b6711f0268cfd884fa28555c6c46093)
- [Tạo và quản lý khóa BoxAI](/docs/console/api-keys) · [Nhật ký sử dụng](/docs/console/usage-logs) · [Model Hub](/pricing)
