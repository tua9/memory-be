# Gia đình và phòng đấu trí nhớ

Ba mẹ và con đều là tài khoản thường (đăng ký, đăng nhập, đặt lại mật khẩu như nhau). Mọi API dưới đây dùng phiên đăng nhập thường và trả `{ status: "success", data }`.

## Liên kết gia đình

Một tài khoản có thể theo dõi nhiều con; mỗi con có tối đa 4 người theo dõi. Hai cách liên kết:

1. **Mã liên kết.** Con tạo mã 6 ký tự (`POST /api/family/link-code`), mã sống 10 phút, mỗi con chỉ có một mã còn hiệu lực. Ba mẹ nhập mã (`POST /api/family/links { code }`): mã bị dùng hết ngay, liên kết ở trạng thái `pending`. Con đồng ý (`POST /api/family/links/:id/accept`) thì liên kết thành `active`.
2. **Mời qua email.** Con gửi lời mời (`POST /api/family/invites { email }`, tối đa 5 lời mời/ngày). Thư chứa `CLIENT_URL/family/invite#token=…`, hiệu lực 7 ngày, dùng một lần. Trang lời mời xem trước người mời bằng `POST /api/family/invites/inspect { token }` (không cần đăng nhập), rồi người nhận đăng nhập và gọi `POST /api/family/invites/accept { token }`. Liên kết `active` ngay vì chính con đã mời.

`GET /api/family` trả `children` (con mình theo dõi), `guardians` (người theo dõi mình, gồm cả yêu cầu đang chờ) và `code` (mã đang mở). `DELETE /api/family/links/:id` dùng cho cả hai bên: từ chối, huỷ yêu cầu hoặc gỡ liên kết.

Ba mẹ chỉ xem được con có liên kết `active` và tài khoản con đang hoạt động: `GET /api/family/children/:childId/overview | report?period=day|week&date=YYYY-MM-DD | games`, `PATCH /api/family/children/:childId { ageGroup }`. Báo cáo lấy từ các ván con đã hoàn thành; ngày theo `Asia/Ho_Chi_Minh`, tuần bắt đầu thứ Hai.

Nhập mã liên kết, mã phòng và xem trước lời mời bị giới hạn 30 lần/15 phút mỗi IP.

## Phòng đấu

Ai đăng nhập cũng tạo được phòng (`POST /api/rooms { gameName, mode, gameLevel | itemCount, memorizeSec, roundCount }`) và chọn được mọi cấp độ, vì phòng đấu không ghi vào tiến độ, EXP, streak hay lịch sử cá nhân. Ai có mã 6 ký tự cũng vào được (`POST /api/rooms/:code/join`) khi phòng còn chờ và chưa đủ 2 người.

Các thao tác: `GET /:code`, `POST /:code/leave | kick { userId } | ready { ready } | start | recall | submit { answers } | next | finish | rematch`, `GET /api/rooms/stats`, `GET /api/rooms/leaderboard`. Chủ phòng mới được bắt đầu, chuyển vòng, kết thúc, chơi lại và mời người ra. Rời phòng được lúc chờ hoặc sau khi trận xong; chủ phòng rời thì phòng đóng.

**Chơi lại.** Sau khi trận xong (hoặc bị dừng), chủ phòng gọi `POST /:code/rematch`: không gửi gì thì giữ trò và cài đặt cũ, gửi cài đặt như lúc tạo phòng thì đổi trò. Phòng về trạng thái chờ với những người đang ở đó (đều phải bấm sẵn sàng lại), mỗi trận có `matchId` riêng và `history` giữ người thắng các trận trước để hiện tỉ số chung. Client tiếp tục hỏi phòng (chậm hơn) sau khi trận xong để thấy trận mới.

- Client hỏi phòng mỗi 2 giây. Server đối chiếu hạn giờ theo đồng hồ của mình và **chỉ ghi DB khi có thay đổi**.
- Bài nộp trong vòng 3 giây sau khi hết giờ vẫn được nhận (thời gian tính tới lúc hết giờ). Sau đó người chưa nộp được nộp bài trắng.
- Có kết quả vòng mà 2 phút không ai chuyển vòng: phòng hoàn thành nếu là vòng cuối, ngược lại bị huỷ.
- Thắng vòng: nhiều vị trí đúng hơn, bằng nhau thì ít thời gian hơn; không ai đúng hoặc bằng nhau hoàn toàn thì hoà.
- Trận hoàn thành ghi `room_results` cho từng người (`roomId` là mã trận). Người thắng trận (thắng nhiều vòng hơn) nhận **1 cúp**, khi cả hai đều có trả lời ở mọi vòng; hoà thì không ai có cúp.
- Bảng xếp hạng cộng cúp theo người (top 20, cùng số cúp thì cùng hạng), kèm hạng của người đang xem.
- Phòng tự xoá sau 24 giờ không có hoạt động; `room_results` được giữ lại (dashboard gia đình dùng để đếm số trận ba mẹ đấu cùng con).

Xoá tài khoản sẽ xoá liên kết (cả hai chiều), mã, lời mời, phòng có người đó và kết quả trận của người đó.
