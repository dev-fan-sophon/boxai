---
title: Làm việc với dự án và phiên hội thoại
summary: Mở thư mục, giao tác vụ có phạm vi rõ ràng và kiểm tra kết quả trong từng phiên làm việc.
section: clients
order: 14
audience: [user]
updated: 2026-10-02
status: published
---

## Mở dự án

1. Chuẩn bị một thư mục nhỏ trên máy mà bạn đồng ý cho trợ lý đọc. Commit hoặc sao lưu các tệp quan trọng trước.
2. Dùng chức năng thêm/tạo dự án để chọn thư mục có sẵn. Có thể chọn nhiều thư mục khi cần, nhưng chỉ cấp phạm vi cần thiết cho tác vụ.
3. Kiểm tra tên dự án và các đường dẫn đã chọn. Tùy chọn Git cho phép sao chép kho mã vào nơi bạn chọn; bạn vẫn cần có quyền truy cập kho mã đó.
4. Chọn dự án rồi bắt đầu phiên làm việc mới.

![Dự án minh họa Lotus Travel với tác vụ sửa giảm giá đã hoàn tất và kết quả kiểm thử](/desktop-screenshots/docs/project-session.webp 'Ví dụ tác vụ có sửa tệp đã hoàn thành. Kiểm tra tệp thay đổi và kết quả kiểm thử; đây không phải ví dụ tác vụ chỉ đọc bên dưới.')

## Giao tác vụ rõ ràng

Bắt đầu ở chế độ **Agent** với quyền **Ask** (Hỏi trước). Thử yêu cầu: “Đọc README và giải thích cấu trúc dự án. Không sửa tệp hay chạy lệnh cài đặt.” Câu chữ thể hiện ý định của bạn; [quyền công cụ](/docs/clients/desktop/tool-approvals) mới kiểm soát việc phê duyệt, vì vậy vẫn cần xem từng yêu cầu thực tế.

Khi cần thay đổi, hãy nêu kết quả mong muốn, tệp liên quan, giới hạn và cách kiểm tra. Tách công việc không liên quan thành các phiên riêng. Đổi phiên sẽ đổi ngữ cảnh hội thoại, nhưng các phiên trong cùng dự án vẫn có thể sửa chung tệp; đây không phải cơ chế cách ly hệ thống tệp.

## Chọn chế độ làm việc

- **Agent** thực hiện tác vụ trực tiếp bằng các công cụ được phép.
- **Plan** chuẩn bị phương án để bạn xem xét. Đọc kế hoạch trước khi duyệt thực hiện và chủ động chọn chế độ quyền.
- **Goal** hỗ trợ công việc tự động dài hơn và dùng quyền Auto. Không nên chọn cho lần thử đầu tiên; chỉ dùng khi đã hiểu phạm vi và các tác động có thể xảy ra.

Chế độ làm việc và chế độ quyền là hai lựa chọn khác nhau. Duyệt một kế hoạch không bảo đảm mọi thao tác về sau đều an toàn.

## Kiểm tra rồi tiếp tục

Đọc câu trả lời và kết quả công cụ, xem thay đổi trong tệp, rồi chạy kiểm tra phù hợp trước khi dùng kết quả. Nếu tác vụ đi sai hướng, hãy dừng, kiểm tra những gì đã xảy ra và đưa ra yêu cầu tiếp theo hẹp hơn. Dừng tác vụ không hoàn tác việc sửa tệp hay thao tác trên dịch vụ bên ngoài.

Danh sách phiên cho phép quay lại hội thoại, ghim phiên hữu ích, lưu trữ công việc đã xong hoặc xóa phiên. Nếu chỉ muốn danh sách gọn hơn, ưu tiên lưu trữ thay vì xóa. Luôn sao lưu độc lập các tệp quan trọng; lịch sử trò chuyện không thay thế hệ thống quản lý phiên bản.

## Kiểm tra kết quả

Đúng dự án đang được chọn, hội thoại có kết quả hoàn thành và các thay đổi đã vượt qua bước kiểm tra của bạn. Nếu phiên có vẻ bị kẹt, tìm [yêu cầu đang chờ duyệt](/docs/clients/desktop/tool-approvals) trước khi gửi lại tác vụ.

Tiếp theo: [Phê duyệt công cụ](/docs/clients/desktop/tool-approvals) · [Skill, plugin và MCP](/docs/clients/desktop/extensions).
