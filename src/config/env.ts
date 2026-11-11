import dotenv from "dotenv";

dotenv.config();

const NODE_ENVS = ["development", "production", "test"] as const;
type NodeEnv = (typeof NODE_ENVS)[number];

const NODE_ENV = process.env.NODE_ENV || "development";
if (!NODE_ENVS.includes(NODE_ENV as NodeEnv)) {
    throw new Error(`Invalid NODE_ENV "${NODE_ENV}". Expected one of: ${NODE_ENVS.join(", ")}`);
}

export const env = {
    NODE_ENV: NODE_ENV as NodeEnv,
    IS_PRODUCTION: NODE_ENV === "production",
    PORT: process.env.PORT || 5001,
    CLIENT_URL: process.env.CLIENT_URL || "http://localhost:5173",
    MONGODB_CONNECTION_STRING: process.env.MONGODB_CONNECTION_STRING?.trim() || "",
    MONGODB_TEST_CONNECTION_STRING: process.env.MONGODB_TEST_CONNECTION_STRING?.trim() || "",
    GEMINI_API_KEY: process.env.GEMINI_API_KEY?.trim() || "",
    GEMINI_MODEL: process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite",
    ACCESS_TOKEN_SECRET: process.env.ACCESS_TOKEN_SECRET || "",
    REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET || "",
    ACCESS_TOKEN_TTL: process.env.ACCESS_TOKEN_TTL || "15m",
    REFRESH_TOKEN_TTL: process.env.REFRESH_TOKEN_TTL || "14d",
    // Thời hạn tối đa của phiên khi người dùng không chọn "Duy trì đăng nhập"
    REFRESH_TOKEN_TTL_NO_REMEMBER: process.env.REFRESH_TOKEN_TTL_NO_REMEMBER || "1d",
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    // Gửi email (link đổi mật khẩu). Thiếu cấu hình thì API gửi link báo lỗi 503, không giả vờ đã gửi.
    SMTP_HOST: process.env.SMTP_HOST?.trim() || "",
    SMTP_PORT: Number(process.env.SMTP_PORT) || 587,
    SMTP_USER: process.env.SMTP_USER?.trim() || "",
    SMTP_PASS: process.env.SMTP_PASS || "",
    // Tên hiển thị hoặc "Tên <địa chỉ>"; nếu bỏ trống dùng SMTP_USER
    MAIL_FROM: process.env.MAIL_FROM?.trim() || "",
    // Số proxy đứng trước server (vd. 1 khi deploy sau Render/Nginx) để giới hạn theo IP đọc đúng IP người dùng.
    // Bỏ trống khi chạy trực tiếp: tin X-Forwarded-For lúc đó cho phép giả IP để né giới hạn.
    TRUST_PROXY: Number(process.env.TRUST_PROXY) || 0,
};