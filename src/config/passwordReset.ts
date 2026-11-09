// Mục đích của link, để token đổi mật khẩu không dùng nhầm cho việc khác về sau
export const PASSWORD_RESET_PURPOSE = "CHANGE_PASSWORD" as const;
export const PARENT_PASSWORD_RESET_PURPOSE = "CHANGE_PARENT_PASSWORD" as const;
export type PasswordResetPurpose = typeof PASSWORD_RESET_PURPOSE | typeof PARENT_PASSWORD_RESET_PURPOSE;

// Link có hiệu lực 15 phút, dùng một lần
export const PASSWORD_RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
// Giữa hai lần gửi link phải cách nhau tối thiểu 60 giây
export const PASSWORD_RESET_RESEND_COOLDOWN_MS = 60 * 1000;
// Tối đa 5 lần gửi trong mỗi cửa sổ 30 phút (tính theo tài khoản + mục đích)
export const PASSWORD_RESET_WINDOW_MS = 30 * 60 * 1000;
export const PASSWORD_RESET_MAX_SENDS_PER_WINDOW = 5;

// 32 byte ngẫu nhiên mã hoá base64url = 43 ký tự
export const PASSWORD_RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const PASSWORD_RESET_ERROR_CODES = {
    INVALID_TOKEN: "INVALID_RESET_TOKEN",
    RATE_LIMITED: "RESET_LINK_RATE_LIMITED",
    INVALID_PASSWORD: "INVALID_PASSWORD",
    PASSWORD_MISMATCH: "PASSWORD_MISMATCH",
    SAME_PASSWORD: "SAME_PASSWORD",
    INCORRECT_CURRENT_PASSWORD: "INCORRECT_CURRENT_PASSWORD",
    CURRENT_PASSWORD_REQUIRED: "CURRENT_PASSWORD_REQUIRED",
    EMAIL_NOT_CONFIGURED: "EMAIL_NOT_CONFIGURED",
    EMAIL_DELIVERY_FAILED: "EMAIL_DELIVERY_FAILED",
    SESSION_REVOKE_FAILED: "SESSION_REVOKE_FAILED",
} as const;

