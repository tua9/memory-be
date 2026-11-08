# Tài liệu API & Tích hợp Frontend: Ghi nhớ số ngẫu nhiên (Random Numbers)

Chức năng "Ghi nhớ số ngẫu nhiên" (Numbers Memory) cho phép người dùng luyện tập hoặc thử thách khả năng ghi nhớ dãy số theo cơ chế tương tự Memory League Numbers.

---

## 1. Tổng quan kiến trúc & quy ước

- **Prefix route:** `/api/v1/numbers` (hoặc `/api/numbers`).
- **Xác thực:** Yêu cầu đăng nhập (`protectedRoute`). User được nhận diện qua cookie httpOnly `accessToken` hoặc header `Authorization: Bearer <token>`.
- **Cache Header:** Mọi response liên quan đến lượt chơi đều trả `Cache-Control: no-store`.
- **Bảo mật dãy số:**
  - `digits` (dãy gốc) chỉ trả về khi lượt chơi ở trạng thái `memorizing`.
  - Khi đã chuyển sang `recalling` hoặc trong danh sách lịch sử, dãy số gốc bị ẩn hoàn toàn khỏi response server.
  - *Lưu ý bảo mật*: Do dãy gốc từng được gửi về trình duyệt ở giai đoạn memorizing, người dùng có kỹ thuật vẫn có thể chụp lại bằng DevTools; vì vậy không tuyên bố cơ chế chống gian lận tuyệt đối ở client-side.
- **Tính toán thời gian & Deadlines:**
  - Toàn bộ deadline tính theo thời điểm server ghi nhận (`serverNow`, `memorizeEndsAt`, `recallEndsAt`). Server không tin timestamp do client tự khai.
  - Phục hồi lượt chơi sau khi tải lại trang: Gọi `GET /sessions/:id`.

---

## 2. Danh sách Endpoints

### 2.1. Tạo lượt chơi mới (Create Session)
- **Method / URL:** `POST /api/v1/numbers/sessions`
- **Headers:** `Content-Type: application/json`
- **Request Body (Practice Mode):**
  ```json
  {
    "mode": "practice",
    "digitCount": 8,
    "memorizeSeconds": 60,
    "recallSeconds": 120
  }
  ```
  *(Các tham số trên là tùy chọn trong practice, có giá trị mặc định như trên. Giới hạn: digitCount 4–80, memorizeSeconds 5–300, recallSeconds 10–600)*.
- **Request Body (Challenge Mode):**
  ```json
  {
    "mode": "challenge"
  }
  ```
  *(Cố định: digitCount=80, memorizeSeconds=60, recallSeconds=240. Nghiêm cấm gửi tham số thời gian/số lượng khác; server sẽ trả lỗi 400 nếu vi phạm)*.
- **Response:** `201 Created`
  ```json
  {
    "status": "success",
    "data": {
      "id": "673f8a...",
      "mode": "practice",
      "digitCount": 8,
      "memorizeSeconds": 60,
      "recallSeconds": 120,
      "phase": "memorizing",
      "revision": 0,
      "digits": ["0", "7", "2", "2", "9", "4", "0", "8"],
      "startedAt": "2026-10-24T10:00:00.000Z",
      "memorizeEndsAt": "2026-10-24T10:01:00.000Z",
      "recallStartedAt": null,
      "recallEndsAt": null,
      "completedAt": null,
      "completionReason": null,
      "memorizeUsedMs": null,
      "serverNow": "2026-10-24T10:00:00.000Z"
    }
  }
  ```

---

### 2.2. Lấy trạng thái hiện tại (Get Session)
- **Method / URL:** `GET /api/v1/numbers/sessions/:id`
- **Mục đích:** Dùng khi vào màn hình, refresh trang hoặc kiểm tra tiến độ đồng hồ. Server tự động kiểm tra và đồng bộ trạng thái nếu deadline đã qua.
- **Response (khi memorizing):** Có mảng `digits`.
- **Response (khi recalling):** Có `answers`, không có `digits`.
- **Response (khi completed):** Có `answers`, `result` và `comparison`.

---

### 2.3. Kết thúc ghi nhớ sớm (Start Recall)
- **Method / URL:** `POST /api/v1/numbers/sessions/:id/recall`
- **Mục đích:** Người dùng bấm nút "Bắt đầu nhập" trước khi hết thời gian ghi nhớ.
- **Cơ chế thời gian:**
  - Nếu gọi trước `memorizeEndsAt`: `recallStartedAt = now`, `recallEndsAt = now + recallSeconds`, `memorizeUsedMs = recallStartedAt - startedAt`.
  - Nếu gọi khi đã quá `memorizeEndsAt`: `recallStartedAt = memorizeEndsAt`, `recallEndsAt = memorizeEndsAt + recallSeconds`. Không tặng thêm thời gian trễ.
  - Nếu đã ở `recalling`: Trả về trạng thái hiện tại, không reset đồng hồ.
  - Nếu đã `completed`: Trả về kết quả, không mở lại lượt chơi.
- **Response:** `200 OK` (chuyển sang `phase: "recalling"`, `revision` tăng lên 1, mảng `digits` biến mất, xuất hiện `answers`).

---

### 2.4. Lưu đáp án tạm thời (Autosave Answers)
- **Method / URL:** `PUT /api/v1/numbers/sessions/:id/answers`
- **Headers:** `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "revision": 1,
    "answers": ["0", "7", null, "2", "9", null, null, null]
  }
  ```
- **Ràng buộc:**
  - Chỉ gọi khi `phase == "recalling"` và trước `recallEndsAt`.
  - `answers` bắt buộc là mảng có đúng `digitCount` phần tử.
  - Mỗi phần tử là ký tự 1 chữ số `"0"` đến `"9"` hoặc `null` (ô trống).
  - `revision` phải khớp với revision hiện tại của server. Nếu không khớp, server trả lỗi `409 Conflict` kèm code `"REVISION_CONFLICT"`.
- **Response:** `200 OK` (kèm `revision` mới = `revision + 1`).

---

### 2.5. Nộp bài (Submit Session)
- **Method / URL:** `POST /api/v1/numbers/sessions/:id/submit`
- **Headers:** `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "revision": 2,
    "answers": ["0", "7", "3", "2", null, "4", "0", "8"]
  }
  ```
- **Xử lý bất đồng bộ & tranh chấp:**
  - Nếu nộp đúng hạn: Server lưu đáp án và chấm điểm nguyên tử trong DB, cập nhật `completionReason: "submitted"`, `completedAt: now`.
  - Nếu quá hạn recall: Server chấm dựa trên đáp án đã lưu hợp lệ gần nhất trước deadline, bỏ qua payload gửi muộn, gán `completionReason: "timeout"`.
  - Nếu session đã ở `phase: "completed"` (ví dụ ấn submit 2 lần): Server trả ngay kết quả đã lưu mà không chấm lại hay thay đổi điểm.
- **Response:** `200 OK`
  ```json
  {
    "status": "success",
    "data": {
      "id": "673f8a...",
      "phase": "completed",
      "completionReason": "submitted",
      "result": {
        "score": 6,
        "accuracy": 75,
        "correctCount": 6,
        "wrongCount": 1,
        "blankCount": 1,
        "total": 8,
        "completionReason": "submitted",
        "memorizeUsedMs": 15420
      },
      "comparison": [
        { "index": 0, "expected": "0", "actual": "0", "status": "correct" },
        { "index": 1, "expected": "7", "actual": "7", "status": "correct" },
        { "index": 2, "expected": "2", "actual": "3", "status": "wrong" },
        { "index": 3, "expected": "2", "actual": "2", "status": "correct" },
        { "index": 4, "expected": "9", "actual": null, "status": "blank" },
        { "index": 5, "expected": "4", "actual": "4", "status": "correct" },
        { "index": 6, "expected": "0", "actual": "0", "status": "correct" },
        { "index": 7, "expected": "8", "actual": "8", "status": "correct" }
      ],
      "serverNow": "2026-10-24T10:02:15.000Z"
    }
  }
  ```

---

### 2.6. Lịch sử luyện tập (Get History)
- **Method / URL:** `GET /api/v1/numbers/sessions?page=1&limit=10&mode=practice&phase=completed`
- **Query params:**
  - `page`: số nguyên >= 1 (mặc định 1).
  - `limit`: số nguyên từ 1 đến 50 (mặc định 10).
  - `mode`: `"practice"` hoặc `"challenge"` (tùy chọn).
  - `phase`: `"memorizing"`, `"recalling"`, hoặc `"completed"` (tùy chọn).
- **Đặc điểm bảo mật:** Chỉ trả tóm tắt thông số, không chứa `digits` gốc hay mảng `answers`.

---

### 2.7. Chi tiết kết quả (Get Result)
- **Method / URL:** `GET /api/v1/numbers/sessions/:id/result`
- **Quy tắc:** Chỉ trả về kết quả khi session đã ở `phase: "completed"`. Nếu chưa hoàn thành, trả `400 Bad Request`.

---

## 3. Hướng dẫn tích hợp cho Frontend Engineer

1. **Chuẩn bị đếm ngược (3–2–1):**
   - Frontend nên hiển thị bộ đếm 3-2-1 trước khi gọi `POST /sessions`.
   - Không gọi API trước đếm ngược để tránh lãng phí thời gian ghi nhớ.
2. **Đồng bộ thời gian bằng `serverNow`:**
   - Khi nhận response từ POST tạo hoặc GET session, tính độ lệch:
     `clientOffset = Date.parse(response.data.serverNow) - Date.now()`.
   - Deadline hiển thị: `Date.parse(memorizeEndsAt) - clientOffset`.
3. **Ẩn số khi chuyển phase:**
   - Ngay khi gọi `POST /sessions/:id/recall` hoặc khi đếm ngược ghi nhớ kết thúc, ẩn UI dãy số ngay lập tức.
4. **Autosave khi nhập đáp án:**
   - Debounce việc lưu đáp án (khoảng 500ms - 1000ms) sau khi người dùng gõ phím.
   - Luôn gửi `revision` hiện tại. Khi autosave thành công, cập nhật `currentRevision = response.data.revision`.
5. **Tuần tự hóa Autosave và Submit:**
   - Khi người dùng bấm "Nộp bài", hủy bộ đếm debounce autosave đang chờ (nếu có).
   - Đảm bảo autosave trước đó đã hoàn tất trước khi phát lệnh submit.
6. **Xử lý lỗi `409 REVISION_CONFLICT`:**
   - Nếu gặp lỗi 409 với code `"REVISION_CONFLICT"`, gọi `GET /sessions/:id` để lấy trạng thái và `revision` mới nhất từ server, hòa trộn dữ liệu rồi thử lại.
7. **Tránh nộp bài sát nút:**
   - Khuyên người dùng nên nộp bài trước khi đồng hồ chạm 0 giây một chút để tránh độ trễ mạng khiến request bị tính là quá hạn.
8. **Phục hồi phiên khi reload:**
   - Lưu `currentSessionId` vào sessionStorage hoặc URL params (ví dụ `/practice/numbers/:id`).
   - Khi load trang, gọi `GET /sessions/:id`. Nếu phase là `memorizing` hoặc `recalling`, render lại đúng trạng thái và tiếp tục đếm giờ.
