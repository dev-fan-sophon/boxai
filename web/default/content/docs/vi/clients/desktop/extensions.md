---
title: Thêm skill, plugin và công cụ MCP
summary: Mở rộng Desktop có kiểm soát, chọn phạm vi toàn cục hoặc theo dự án và kiểm tra từng khả năng trước khi dùng.
section: clients
order: 16
audience: [user, developer]
updated: 2026-10-02
status: published
---

## Chọn đúng loại mở rộng

| Loại        | Dùng để                                                                | Cần xem trước khi bật                                         |
| ----------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| Skill       | Tái sử dụng hướng dẫn và kiến thức cho tác vụ                          | Nội dung hướng dẫn, tập lệnh đi kèm và nguồn cung cấp.        |
| Plugin      | Bổ sung khả năng, lệnh hoặc giao diện cho ứng dụng                     | Tác giả, quyền, mã nguồn và nguồn cập nhật.                   |
| Máy chủ MCP | Cung cấp công cụ hoặc dữ liệu từ tiến trình trên máy hay dịch vụ từ xa | Lệnh/URL, thông tin xác thực, quyền tệp và chi phí bên ngoài. |

Có mặt trong danh mục không đồng nghĩa với được chứng nhận an toàn. Mọi yêu cầu mô hình tích hợp đều qua BoxAI, nhưng phần mở rộng có thể chạy chương trình trên máy hoặc liên hệ dịch vụ khác. Đừng mặc định dữ liệu của chúng chỉ được xử lý tại BoxAI.

<!-- Screenshot: /desktop-screenshots/docs/settings.webp — phần cài đặt Skills/MCP thực tế với phạm vi dự án. -->

## Thêm skill

1. Mở trang **Skills** trong cài đặt.
2. Chọn phạm vi toàn cục nếu cần dùng ở nhiều dự án, hoặc phạm vi dự án đang chọn cho hướng dẫn riêng của dự án.
3. Tạo, nhập hoặc chỉnh sửa skill bằng chức năng có sẵn. Đọc nội dung trước khi bật.
4. Thử trong phiên dùng dữ liệu mẫu, với yêu cầu nhỏ thực sự cần skill đó.

Skill nằm trong `.agents/skills` của dự án hoặc `~/.agents/skills` ở phạm vi toàn cục. Tài nguyên toàn cục có thể ảnh hưởng nhiều dự án; tránh vô tình đặt hướng dẫn riêng tư của một dự án vào đó.

## Kết nối máy chủ MCP

1. Mở cài đặt **MCP**, chọn phạm vi toàn cục hoặc theo dự án.
2. Thêm/nhập cấu hình từ nguồn đáng tin cậy. Với máy chủ chạy trên máy, kiểm tra chương trình và tham số; với máy chủ từ xa, kiểm tra URL và cách xác thực.
3. Cung cấp thông tin xác thực cần thiết một cách riêng tư. Máy chủ cục bộ có thể cần công cụ không đi kèm Desktop; làm theo hướng dẫn cài đặt của máy chủ đó.
4. Chạy kiểm tra kết nối, bật máy chủ rồi thử một thao tác không gây thay đổi quan trọng. Lưu được cấu hình chưa có nghĩa là kết nối hoạt động.

Cấu hình MCP nằm trong `.agents/servers` của dự án hoặc `~/.agents/servers` ở phạm vi toàn cục. Không commit cấu hình chứa thông tin bí mật vào kho dùng chung. Xem xét từng yêu cầu công cụ bằng [quyền Ask](/docs/clients/desktop/tool-approvals).

## Cài plugin

Mở **Plugins**. Tab **Marketplace** hiển thị các gói có sẵn; **Installed** cho phép bật, cấu hình và quản lý gói đã cài. Đọc nguồn cung cấp và các quyền được yêu cầu trước khi cài. Chức năng nạp plugin đang phát triển và tạo từ mẫu dành cho người hiểu mã được chạy, không phải cách bỏ qua cảnh báo tin cậy.

Sau khi cài, kiểm tra phạm vi/cài đặt của plugin và thử chức năng được giới thiệu. Cập nhật plugin tách biệt với [cập nhật ứng dụng](/docs/clients/desktop/updates); đọc thay đổi trước khi áp dụng.

## Khi phần mở rộng gây lỗi

Tắt tài nguyên vừa thêm rồi thử lại cùng tác vụ nhỏ. Nếu lỗi biến mất, kiểm tra cấu hình hoặc liên hệ tác giả kèm thông tin chẩn đoán đã che dữ liệu nhạy cảm. Tắt tài nguyên không hoàn tác lệnh, sửa đổi tệp hoặc thao tác bên ngoài mà nó đã thực hiện.

Tiếp theo: [Khắc phục sự cố](/docs/clients/desktop/troubleshooting) · [Quyền công cụ](/docs/clients/desktop/tool-approvals).
