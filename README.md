# Memio Backend (training-memory-be)

Backend API phục vụ ứng dụng luyện trí nhớ Memio.

## Công nghệ sử dụng
- **Runtime:** Node.js (v20+ LTS, ESM)
- **Framework:** Express 5
- **Ngôn ngữ:** TypeScript (Strict mode)
- **Cơ sở dữ liệu:** MongoDB Atlas (với Mongoose ODM)
- **Xác thực:** JWT (Cookie httpOnly & Bearer Header)
- **Bundler / Runner:** tsx & esbuild

---

## Cài đặt & Khởi chạy

### 1. Cấu hình môi trường
Sao chép `.env.example` thành `.env` và điền thông tin:
```bash
cp .env.example .env
```

#### Hướng dẫn cấu hình MongoDB Atlas (`MONGODB_CONNECTION_STRING`):
1. **Tạo Database User trên Atlas:**
   - Đăng nhập vào trang quản trị MongoDB Atlas.
   - Vào menu **Security** > **Database Access** > chọn **Add New Database User**.
   - Phân biệt: Tài khoản đăng nhập trang web Atlas (email cá nhân) **khác hoàn toàn** với Database User (tài khoản do MongoDB sinh ra dùng để ứng dụng kết nối).
   - Chọn phương thức xác thực Password, cấp quyền `readWriteAnyDatabase` hoặc cấp quyền đọc/ghi trên database của ứng dụng (ví dụ: `memio`).
   - **Lưu ý về mật khẩu:** Nếu mật khẩu chứa ký tự đặc biệt như `@`, `#`, `:`, `/`, `?`, `%`, bạn **bắt buộc phải mã hóa percent-encode** (RFC 3986, ví dụ `@` đổi thành `%40`, `#` đổi thành `%23`) trước khi đưa vào URI.
2. **Cấu hình Network Access (IP Whitelist):**
   - Vào menu **Security** > **Network Access** > chọn **Add IP Address**.
   - Thêm địa chỉ **IP Public hiện tại** của máy tính hoặc server chạy backend (`Add Current IP Address`).
   - **Cảnh báo bảo mật:** Không chọn mở `0.0.0.0/0` (Allow Access from Anywhere) cho môi trường chính thức vì điều đó làm tăng nguy cơ bị tấn công dò quét mật khẩu từ internet.
3. **Lấy chuỗi kết nối (Connection String):**
   - Vào mục **Deployment** > **Database**, chọn **Connect** > **Drivers** (Node.js).
   - Điền tên database mong muốn vào đường dẫn URI:
     ```env
     MONGODB_CONNECTION_STRING=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/memio?retryWrites=true&w=majority
     ```

#### Cấu hình Database Test riêng biệt (`MONGODB_TEST_CONNECTION_STRING`):
Để bảo vệ an toàn cho dữ liệu ứng dụng, hệ thống tích hợp **Safety Guard** ngăn chặn hoàn toàn việc chạy integration tests trên database ứng dụng:
- Tên database test **bắt buộc phải chứa chữ "test"** (ví dụ `memio_test`).
- Tên database test **không được trùng** với database của ứng dụng.
- Có thể dùng database test trên Atlas hoặc MongoDB local:
  ```env
  # Cách 1: Dùng MongoDB local cho test
  MONGODB_TEST_CONNECTION_STRING=mongodb://127.0.0.1:27017/memio_test

  # Cách 2: Dùng cluster Atlas riêng cho test
  MONGODB_TEST_CONNECTION_STRING=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/memio_test?retryWrites=true&w=majority
  ```
- Nếu thiếu biến này, integration test sẽ dừng ngay lập tức với lỗi cấu hình rõ ràng, tuyệt đối không tự động fallback sang `MONGODB_CONNECTION_STRING`.

---

### 2. Cài đặt dependencies
```bash
npm install
```

### 3. Các lệnh chính
- `npm run dev`: Chạy server chế độ phát triển với nodemon và tsx.
- `npm run typecheck`: Kiểm tra kiểu TypeScript với `tsc`.
- `npm run build`: Kiểm tra kiểu và bundle mã nguồn sang `dist/server.js`.
- `npm start`: Chạy file build production `dist/server.js`.
- `npm test`: Chạy toàn bộ unit tests và integration tests.
- `npm run test:unit`: Chỉ chạy unit tests (không cần kết nối database).
- `npm run test:integration`: Chạy integration tests (kiểm tra an toàn qua test guard).

---

## Chức năng: Ghi nhớ số ngẫu nhiên (Random Numbers)

Hỗ trợ 2 chế độ luyện tập:
1. **practice**: Tùy chỉnh số lượng số (4–80), thời gian ghi nhớ (5–300s), thời gian recall (10–600s).
2. **challenge**: Cố định 80 số, 60s ghi nhớ, 240s recall theo luật Memory League Numbers.

### API Endpoints (`/api/v1/numbers` hoặc `/api/numbers`):
- `POST /sessions`: Tạo lượt chơi mới (sinh dãy ngẫu nhiên bằng `node:crypto`).
- `GET /sessions/:id`: Lấy trạng thái lượt chơi, tự động đồng bộ deadline.
- `POST /sessions/:id/recall`: Kết thúc ghi nhớ sớm, chuyển sang phase recalling.
- `PUT /sessions/:id/answers`: Lưu đáp án tạm thời (autosave với optimistic locking qua revision).
- `POST /sessions/:id/submit`: Nộp bài và chấm điểm nguyên tử.
- `GET /sessions`: Lịch sử luyện tập phân trang và lọc theo mode/phase.
- `GET /sessions/:id/result`: Chi tiết kết quả và so sánh từng vị trí.

Xem tài liệu chi tiết tại [`docs/random-numbers-api.md`](./docs/random-numbers-api.md).

## Huấn luyện viên AI

`GET /api/progress/coach` yêu cầu đăng nhập và phân tích các ván theo cấp độ, độ chính xác, kỷ lục và số ván của chính tài khoản đó trong cả năm trò chơi (không tính chế độ tự chọn hoặc thử thách ngày). API trả về mức hiện tại, trò mạnh nhất, trò nên ưu tiên và ba buổi luyện tập gợi ý trong tuần.

Phân tích được tính từ dữ liệu tiến độ đã lưu trong MongoDB.

Chat sử dụng Google Gemini; đặt `GEMINI_API_KEY` trong `.env` và tùy chọn model bằng `GEMINI_MODEL` (mặc định `gemini-3.5-flash-lite`). Tin nhắn hội thoại và dữ liệu tóm tắt tiến độ sẽ được gửi tới Google Gemini. Giữ API key trong `.env`, không commit hoặc chia sẻ key. Nếu chưa có key hoặc Gemini không khả dụng, endpoint trả lỗi thay vì chuyển sang model local. `POST /api/progress/coach/chat` nhận tối đa 8 tin nhắn hội thoại; yêu cầu được giới hạn độ dài và số lần gọi để tránh làm quá tải model.
