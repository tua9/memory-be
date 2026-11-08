# Client mobile (React Native)

Web và app mobile dùng chung một backend. Khác nhau duy nhất ở cách mang token và định danh khách:
app mobile gửi header `X-Client: mobile` trong **mọi** request.

| | Web | Mobile (`X-Client: mobile`) |
|---|---|---|
| Nhận token sau login / google / refresh | Cookie httpOnly `accessToken`, `refreshToken` | Body: `data.accessToken`, `data.refreshToken`, `data.accessExpiresAt`, `data.refreshExpiresAt` |
| Gửi access token | Cookie | `Authorization: Bearer <accessToken>` |
| `POST /api/auth/refresh`, `POST /api/auth/logout` | Đọc cookie `refreshToken` | Đọc `{ "refreshToken": "..." }` trong body (bỏ qua cookie) |
| Đăng nhập Google `POST /api/auth/google` | `{ "accessToken": "..." }` | `{ "idToken": "..." }` |
| Khách chơi không đăng nhập | Cookie httpOnly `guestId` | Lần đầu `POST /api/game-sessions` trả `data.guestId`; các request sau gửi `X-Guest-Id: <guestId>` |

## Lưu ý cho app

- Đăng nhập bằng email: gửi `rememberMe: true`, nếu không phiên chỉ sống `REFRESH_TOKEN_TTL_NO_REMEMBER` (mặc định 1 ngày).
- Refresh token xoay vòng mỗi lần gọi `/auth/refresh`: lưu token mới ngay (SecureStore) và chỉ cho **một** lần refresh chạy cùng lúc.
- Access token hết hạn: API trả 401, có thể kèm `code: "TOKEN_EXPIRED"` → refresh rồi gọi lại request một lần.
- Đổi mật khẩu (`PATCH /api/profile/password`) thu hồi mọi phiên: app xoá token đã lưu và về màn đăng nhập.
- Google Sign-In native: cấu hình `webClientId` bằng đúng `GOOGLE_CLIENT_ID` của backend, vì backend kiểm tra `aud` của id token phải bằng giá trị này.
