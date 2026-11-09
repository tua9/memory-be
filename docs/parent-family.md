# Tài khoản phụ huynh và phòng chơi cùng con

## Thiết lập và chạy thử

Chạy backend và frontend theo README của từng repo. Backend cần `MONGODB_CONNECTION_STRING`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, `CLIENT_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` và `MAIL_FROM`. `CLIENT_URL` phải trỏ tới frontend tin cậy để tạo link xác minh và đặt lại mật khẩu. Nếu SMTP chưa cấu hình, tài khoản phụ huynh vẫn ở trạng thái chờ và thao tác gửi thư trả lỗi; có thể thử lại từ hồ sơ con sau khi cấu hình SMTP. Không dùng database ứng dụng đang sử dụng cho test; test tích hợp yêu cầu `MONGODB_TEST_CONNECTION_STRING` trỏ tới database thử nghiệm, tốt nhất là MongoDB replica set.

1. Đăng nhập tài khoản con, mở hồ sơ và đăng ký phụ huynh. Email phụ huynh phải khác email con.
2. Mở thư phụ huynh, vào link xác minh rồi bấm xác nhận. Việc chỉ mở link không tiêu thụ token.
3. Đăng nhập phụ huynh trên thiết bị khác hoặc một hồ sơ trình duyệt riêng. Hai tab cùng hồ sơ trình duyệt dùng chung cookie nên không giữ hai tài khoản độc lập.
4. Phụ huynh mở phòng, chọn game/cấu hình/số vòng rồi gửi mã cho con. Con nhập mã trên ngữ cảnh đăng nhập của mình. Cả hai bấm sẵn sàng; phụ huynh bắt đầu.

## API và dữ liệu

Các response dùng envelope `{ status: "success", data }`. Route `/api/parent/link`, `/register`, `/resend` dùng phiên con. `/api/parent/verify/inspect` và `/confirm` nhận `{ token }` qua POST; token chỉ nằm ở fragment của URL trong thư. `/api/parent/overview`, `/games`, `/report?period=day|week&date=YYYY-MM-DD`, `/age-group` yêu cầu phụ huynh đã xác minh. `/api/parent/password` đổi mật khẩu; `/api/parent/password-reset/forgot|validate|confirm` tái sử dụng luồng đặt lại mật khẩu với loại token riêng. Đăng nhập, refresh và logout dùng chung `/api/auth` cùng cookie/session hiện có; role do backend cấp.

`parents` có unique index cho `childUserId` và email. `login_identities` giữ chỗ email duy nhất khi đăng ký đồng thời giữa user và parent, đồng thời kiểm tra user/parent cũ trước khi tạo. `parent_verifications` lưu hash token một lần, hạn 24 giờ, cooldown gửi 60 giây và tối đa 5 lượt trong 30 phút. `sessions` thêm loại tài khoản và parent ID. `family_rooms` lưu đề, deadline, câu trả lời và kết quả riêng với revision để chống request đồng thời; `parent_points` có unique room ID để cộng đúng một lần. Phòng chơi không ghi vào tiến độ, EXP, streak hoặc lịch sử luyện tập cá nhân.

Phòng hỗ trợ card, image, number, facename và word bằng engine sinh đề/chấm hiện có. Các endpoint `/api/family-rooms` là tạo phòng, `/points` là điểm; `/:code` đọc trạng thái; `/:code/join|ready|start|recall|submit|next|finish` thực hiện hành động. Chỉ parent đã xác minh và đúng con liên kết đọc/thao tác với phòng. Client polling mỗi 2 giây, tăng khoảng chờ tối đa 10 giây khi lỗi; trạng thái và deadline lấy từ server. Phòng chờ tự hủy sau 24 giờ. Khi đã có kết quả vòng, sau 2 phút không chuyển vòng, server hoàn thành phiên nếu đó là vòng cuối hoặc hủy phiên còn thiếu vòng; thời hạn được xử lý ở request/poll kế tiếp. Đóng trình duyệt không làm người còn lại bị kẹt: khi hết hạn trả lời, server nộp trắng cho người chưa nộp. Client giữ bản nháp câu trả lời trong session storage, server giữ câu đã nộp.

Thắng vòng theo số đúng, rồi thời gian ghi nhớ thực tế cộng thời gian trả lời do server đo; bằng nhau thì hòa. Cả hai cùng 0 đúng thì hòa. Điểm xếp hạng bằng thắng trừ thua, bằng điểm thì đồng hạng. Mỗi phiên hoàn thành đủ vòng và cả hai có ít nhất một đáp án không trống ở mỗi vòng được +10 điểm đồng hành cho parent, không phụ thuộc thắng thua. Không cộng điểm cho phiên hủy hoặc chỉ hết giờ mà không tham gia.

## Báo cáo

Báo cáo dùng lịch sử ván hoàn thành của con và tiến độ hiện có. Độ chính xác lấy tổng vị trí đúng chia tổng vị trí; thời gian chỉ gồm phần ghi nhớ và trả lời được ghi nhận, không đại diện cho toàn bộ thời gian dùng website. Number session ở nguồn riêng được gộp theo ID để tránh đếm một ván hai lần. Ngày theo `Asia/Ho_Chi_Minh`; tuần bắt đầu thứ Hai. Kỳ hiện tại so với cùng khoảng thời gian kỳ trước. Chỉ nêu xu hướng số ván khi cả hai kỳ có ít nhất 3 ván; không suy diễn năng lực từ điểm số. Hoạt động trong phòng chơi tách khỏi thống kê luyện tập cá nhân.
