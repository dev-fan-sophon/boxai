---
title: Xem xét và cấp quyền cho công cụ
summary: Hiểu Ask, Accept edits và Auto trước khi cho phép sửa tệp, chạy lệnh hoặc dùng công cụ bên ngoài.
section: clients
order: 15
audience: [user]
updated: 2026-10-02
status: published
---

## Bắt đầu với Ask

Chọn **Ask** trong phần quyền của phiên khi làm việc với dự án chưa quen hoặc tác vụ mới. Ứng dụng sẽ dừng để xin phép đối với thao tác cần phê duyệt. Đọc tên công cụ, tham số, đường dẫn bị ảnh hưởng và câu lệnh trước khi quyết định. Không phải mọi thao tác chỉ đọc đều cần hỏi lại.

<!-- Screenshot: /desktop-screenshots/docs/permissions.webp — thẻ xin quyền với tham số và các nút quyết định. -->

| Chế độ quyền | Ý nghĩa                                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| Ask          | Giữ yêu cầu xác nhận cho các thao tác cần quyền.                                                                  |
| Accept edits | Cho phép sửa tệp với ít lần hỏi hơn; việc chạy lệnh vẫn có quy tắc phê duyệt riêng.                               |
| Auto         | Cho phép tự thực hiện, kể cả chạy Bash mà không hỏi; câu lệnh có thể sửa tệp hoặc tác động tới dịch vụ bên ngoài. |

Các chế độ này không thay thế sao lưu, giới hạn môi trường thực thi hay việc kiểm tra kết quả. Chế độ **Goal** dùng Auto. Đừng chuyển sang Auto chỉ để làm biến mất một yêu cầu quyền mà bạn chưa hiểu.

## Quyết định với từng yêu cầu

1. Kiểm tra yêu cầu có phục vụ đúng tác vụ và đúng dự án hay không.
2. Với lệnh shell, đọc toàn bộ câu lệnh. Chú ý thao tác xóa, cài gói, truy cập mạng và sử dụng thông tin xác thực của hệ thống đang vận hành.
3. Chọn **Allow once** (Cho phép một lần) cho yêu cầu bạn đã hiểu; chỉ chọn **Allow for this chat** (Cho phép trong cuộc trò chuyện này) khi chấp nhận thao tác lặp lại trong phiên; chọn **Deny** (Từ chối) nếu không cần thiết hoặc chưa rõ.
4. Sau khi thực thi, kiểm tra kết quả công cụ và tệp đã thay đổi. Được cấp quyền không có nghĩa là thao tác đã thành công.

Nếu từ chối, hãy giải thích trợ lý nên làm gì thay thế. Đừng duyệt chỉ dựa vào tên công cụ: công cụ shell quen thuộc vẫn có thể chạy lệnh phá hủy dữ liệu.

## Duyệt kế hoạch riêng

Ở chế độ Plan, đọc các bước dự kiến và các tệp bị ảnh hưởng trước khi duyệt. Phần phê duyệt cho phép chọn Ask, Accept edits hoặc Auto khi thực hiện. Từ chối phương án thiếu giới hạn cần thiết và yêu cầu điều chỉnh.

## Nếu công việc có vẻ bị kẹt

Tìm yêu cầu công cụ hoặc kế hoạch đang chờ duyệt trong phiên hiện tại, kể cả phần hội thoại đã thu gọn. Xử lý yêu cầu đó hoặc dừng tác vụ. Gửi lặp lại cùng chỉ dẫn có thể làm rối các lượt tiếp theo và tăng mức sử dụng mô hình.

Tiếp theo: [Dự án và phiên làm việc](/docs/clients/desktop/projects-and-sessions) · [An toàn khi dùng phần mở rộng](/docs/clients/desktop/extensions).
