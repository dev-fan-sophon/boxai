---
title: Agent, mô hình và Library
summary: Chọn mô hình hội thoại BoxAI cho agent đã cài và sử dụng Library thận trọng.
section: clients
order: 33
audience: [user]
updated: 2026-09-27
status: published
---

## Chọn mô hình cho agent

1. Cài riêng trợ lý lập trình muốn dùng, rồi [đăng nhập Connect](/docs/clients/connect/sign-in).
2. Mở **Agents** và tìm agent trong danh sách được phát hiện. Ví dụ có Claude Code, Codex, Gemini CLI và OpenCode; các điều khiển hiển thị tùy thuộc vào agent.
3. Mở trường chọn mô hình và chọn một mô hình BoxAI có sẵn. Lựa chọn được áp dụng vào cấu hình cục bộ của agent; không có bước lưu bổ sung chung cho mọi lựa chọn mô hình.
4. Chỉ điều chỉnh các trường khác nếu agent có hiển thị, chẳng hạn mức suy luận hoặc các cấp mô hình. Không mặc định mọi agent đều hỗ trợ cùng tùy chọn.
5. Mở lại agent nếu chưa nhận thay đổi, rồi gửi một yêu cầu ngắn không chứa dữ liệu nhạy cảm. Yêu cầu có thể sử dụng số dư hoặc hạn mức gói của tài khoản.

**Kiểm tra kết quả:** mô hình đã chọn xuất hiện ở dòng agent, agent trả lời và yêu cầu tương ứng xuất hiện trong danh sách yêu cầu gần đây của Gateway. Giữ Connect chạy suốt quá trình.

Nếu không thấy agent nào, xác nhận agent được cài cho cùng người dùng hệ điều hành. Kiểm tra các mục thu gọn hoặc bị ẩn trước khi kết luận không được hỗ trợ. Không ghi đè cấu hình agent không liên quan chỉ để buộc ứng dụng nhận diện.

## Những mô hình nào xuất hiện?

Connect lấy danh sách mô hình BoxAI bằng khóa đã cấp quyền và hiển thị các mô hình hội thoại cho lập trình, trò chuyện. Quyền truy cập có thể khác nhau theo tài khoản và giới hạn của khóa; hãy đối chiếu với [danh mục mô hình trên website](/pricing), không dựa vào một danh sách cố định.

Ảnh **đầu vào** được phép nếu mô hình hội thoại và agent hỗ trợ. Điều này không có nghĩa bộ chọn hỗ trợ **tạo** ảnh, video, nhạc, giọng nói hay nội dung đa phương tiện khác. Mô hình embedding và reranking cũng không thuộc bộ chọn hội thoại này. Vì vậy, việc thiếu mô hình tạo nội dung đa phương tiện là bình thường, không phải lý do để dán ID vào cấu hình nhằm bỏ qua bộ lọc.

Nếu thiếu mô hình trò chuyện mong đợi, kiểm tra mạng và quyền của khóa, dùng nút làm mới trên thanh công cụ để cập nhật danh sách rồi mở lại bộ chọn. Xem [xử lý sự cố](/docs/clients/connect/account-and-troubleshooting) nếu vẫn thiếu. Với quy trình API khác, đọc [tổng quan API](/docs/api/overview).

## Library là thư viện tài nguyên gốc

**Library** giữ các quy trình quản lý hướng dẫn, MCP và kỹ năng của Magpie, bao gồm tài nguyên từ các chợ tài nguyên gốc. Nội dung không giới hạn ở tài nguyên chính thức của BoxAI và đây không phải kho mô hình khác.

Trước khi thêm tài nguyên, hãy xem nguồn, hướng dẫn, quyền truy cập và các lệnh hoặc máy chủ mà tài nguyên sử dụng. Thao tác trong Library có thể ghi các tệp mà agent dùng. Không cài tài nguyên chỉ để sửa lỗi đăng nhập và không cung cấp `auth.json` hay khóa BoxAI cho tài nguyên. Tự sao lưu các tệp agent quan trọng trước khi thay đổi; đăng xuất không phải thao tác hoàn tác.

Tiếp theo: [Gateway và Routing](/docs/clients/connect/gateway-and-routing).
