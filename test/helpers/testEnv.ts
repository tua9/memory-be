// Secret giả cho máy chạy test không có file .env. Phải được import trước mọi module của src,
// vì src/config/env.ts đọc biến môi trường ngay khi được import.
process.env.ACCESS_TOKEN_SECRET ||= "test-access-secret";
process.env.REFRESH_TOKEN_SECRET ||= "test-refresh-secret";
