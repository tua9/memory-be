# Quy chuẩn công nghệ và code

> Tài liệu này định nghĩa stack và quy ước cho `training-memory-be`. Stack cốt lõi đã được khởi tạo gồm TypeScript, Express, dotenv, nodemon và tsx; cấu hình thực tế nằm trong `package.json`, `tsconfig.json` và `src/`.

## 1. Stack công nghệ

| Công nghệ  | Vai trò                           | Quy ước                                                                    |
| ---------- | --------------------------------- | -------------------------------------------------------------------------- |
| Node.js    | Runtime                           | Dùng phiên bản LTS; thống nhất phiên bản trong nhóm và CI.                 |
| TypeScript | Ngôn ngữ                          | Bật `strict`; không dùng `any` nếu chưa có lý do rõ ràng.                  |
| Express    | HTTP framework                    | Router xử lý định tuyến; middleware dùng cho các concern xuyên suốt.       |
| dotenv     | Nạp biến môi trường               | Nạp tại điểm khởi động; không đọc `.env` trực tiếp rải rác trong ứng dụng. |
| nodemon    | Theo dõi thay đổi khi phát triển  | Chỉ dùng cho môi trường development, không dùng để chạy production.        |
| tsx        | Chạy TypeScript trong development | Kết hợp với nodemon qua script `dev`.                                      |

Các thư viện bổ trợ như validator, logger, test runner và database client cần được thống nhất trước khi đưa vào dự án. Không tự thêm dependency chỉ để giải quyết một tác vụ nhỏ nếu có thể dùng API sẵn có của nền tảng.

## 2. Cài đặt và scripts

Dùng npm và commit lockfile tương ứng. Scripts hiện tại được khai báo trong `package.json`:

```json
{
    "scripts": {
        "dev": "nodemon --watch src --ext ts --exec tsx src/server.ts",
        "build": "tsc -p tsconfig.json",
        "start": "node dist/server.js",
        "typecheck": "tsc --noEmit"
    }
}
```

`dev` dành cho phát triển; `build` biên dịch sang `dist/`; `start` chạy JavaScript đã build. Không chạy TypeScript trực tiếp bằng nodemon trong production.

## 3. Bố cục thư mục

Tổ chức theo trách nhiệm, chỉ tạo thư mục khi có mã nguồn cần đặt vào đó:

```text
src/
  app.ts                 # Tạo Express app và đăng ký middleware/routes
  server.ts              # Nạp cấu hình và mở cổng
  config/                # Cấu hình ứng dụng, đọc env qua một đầu mối
  routes/                # Khai báo endpoint và gắn middleware/controller
  controllers/            # Nhận request, gọi service, trả response
  services/               # Quy tắc nghiệp vụ
  repositories/           # Truy cập và lưu trữ dữ liệu (khi cần)
  middleware/             # Middleware dùng chung, gồm xử lý lỗi
  types/                  # TypeScript types dùng chung
  utils/                  # Hàm tiện ích thuần, không chứa nghiệp vụ
```

Giữ `app.ts` tách khỏi `server.ts` để có thể import ứng dụng trong kiểm thử mà không tự mở cổng. Tránh tạo tầng repository hoặc abstraction khi chưa có nhu cầu thực tế.

## 4. Quy ước TypeScript

- Bật `strict` trong `tsconfig.json`; ưu tiên suy luận kiểu, khai báo kiểu rõ ở ranh giới module và dữ liệu bên ngoài.
- Không dùng `any` để né lỗi kiểu. Dùng `unknown` rồi kiểm tra kiểu khi dữ liệu đến từ bên ngoài.
- Dùng `type` hoặc `interface` nhất quán theo mục đích; không nhân đôi kiểu dữ liệu nếu có thể tái sử dụng.
- Không dùng non-null assertion (`!`) nếu chưa chứng minh giá trị luôn tồn tại.
- Dùng `async/await` cho luồng bất đồng bộ; luôn xử lý lỗi và không bỏ quên Promise.
- Tên biến/hàm dùng `camelCase`, class/type dùng `PascalCase`, hằng số cấu hình bất biến dùng `UPPER_SNAKE_CASE` khi phù hợp.
- Ưu tiên hàm nhỏ, một trách nhiệm; tránh thay đổi trạng thái dùng chung không cần thiết.

## 5. Express và HTTP API

- Khởi tạo ứng dụng tại `app.ts`; khai báo route theo tài nguyên và phiên bản API nếu dự án cần versioning (ví dụ `/api/v1/users`).
- Route chỉ nối URL, middleware và controller; controller điều phối HTTP, service xử lý nghiệp vụ.
- Dùng đúng HTTP method và status code: `GET` đọc, `POST` tạo/thực hiện, `PUT` thay thế, `PATCH` cập nhật một phần, `DELETE` xóa.
- Validate body, query và params trước khi dùng. Không tin dữ liệu từ client chỉ vì đã khai báo TypeScript type; type không kiểm tra dữ liệu ở runtime.
- Controller phải trả response rõ ràng và kết thúc đúng một lần. Không gửi thông tin nội bộ, stack trace hoặc dữ liệu nhạy cảm về client.
- Dùng error-handling middleware tập trung ở cuối chuỗi middleware. Chuyển lỗi bất đồng bộ tới middleware lỗi; không lặp logic bắt lỗi ở từng route.
- Dùng middleware bảo mật phù hợp (ví dụ giới hạn CORS theo môi trường, security headers và giới hạn request) trước khi public API.
- Không ghi log token, mật khẩu, secret hoặc toàn bộ dữ liệu cá nhân.

## 6. Cấu hình và secrets

- Commit `.env.example` chỉ chứa tên biến và giá trị mẫu không nhạy cảm; không commit `.env`.
- Khai báo biến môi trường bằng tên nhất quán, ví dụ `NODE_ENV`, `PORT`, `DATABASE_URL`.
- Đọc và kiểm tra cấu hình tập trung trong `src/config/`; ứng dụng nên fail sớm với thông báo dễ hiểu nếu thiếu cấu hình bắt buộc.
- Không đặt giá trị bí mật mặc định trong mã nguồn. Không dùng dotenv để thay thế secret manager ở môi trường production.
- Chỉ expose biến thực sự cần cho client nếu sau này có frontend/build tooling; backend không nên trả secrets qua API.

## 7. Lỗi, phản hồi và logging

- Phân biệt lỗi đầu vào, lỗi nghiệp vụ và lỗi hệ thống; ánh xạ chúng sang status code phù hợp.
- Không để mỗi endpoint tự tạo một cấu trúc lỗi khác nhau. Khi thống nhất API contract, giữ format phản hồi nhất quán và tài liệu hóa các trường.
- Log đủ ngữ cảnh để chẩn đoán (ví dụ request ID, method, path), nhưng loại bỏ thông tin nhạy cảm.
- Không dùng `console.log` làm giải pháp logging lâu dài trong production; chọn logger trước khi triển khai logging đầy đủ.

## 8. Kiểm thử và chất lượng

- Kiểm tra type bằng `npm run typecheck` và build bằng `npm run build` trước khi merge.
- Viết unit test cho logic nghiệp vụ; viết integration test cho endpoint quan trọng khi test framework đã được chọn.
- Tạo kiểm thử cho hành vi quan sát được, gồm input hợp lệ, input sai và trường hợp lỗi chính; tránh chỉ kiểm tra chi tiết triển khai nội bộ.
- Khi thêm formatter, linter hoặc test runner, cấu hình qua scripts thống nhất trong `package.json` và chạy cùng CI.

## 9. Quy trình thay đổi

1. Tạo thay đổi nhỏ, đúng một mục đích; cập nhật type và tài liệu API khi contract thay đổi.
2. Không đưa secrets, file build hoặc dependencies cài cục bộ vào commit; giữ lockfile đồng bộ với `package.json`.
3. Chạy typecheck, build và các test liên quan trước khi mở PR.
4. Ghi rõ thay đổi cấu hình môi trường và cập nhật `.env.example` khi thêm biến mới.
