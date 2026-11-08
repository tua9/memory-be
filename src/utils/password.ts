import { StatusCodes } from "http-status-codes";
import { PASSWORD_RESET_ERROR_CODES } from "../config/passwordReset.js";
import ApiError from "./ApiError.js";

// Cùng giới hạn với đăng ký (user.service.ts): tối thiểu 8 ký tự, bcrypt chỉ dùng 72 byte đầu
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

export const assertValidNewPassword = (password: unknown, confirmPassword: unknown): string => {
    if (
        typeof password !== "string" ||
        password.length < PASSWORD_MIN_LENGTH ||
        Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES
    ) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            `Password must be at least ${PASSWORD_MIN_LENGTH} characters and at most ${PASSWORD_MAX_BYTES} bytes`,
            [{ field: "newPassword" }],
            PASSWORD_RESET_ERROR_CODES.INVALID_PASSWORD,
        );
    }
    if (password !== confirmPassword) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            "Passwords do not match",
            [{ field: "confirmPassword" }],
            PASSWORD_RESET_ERROR_CODES.PASSWORD_MISMATCH,
        );
    }
    return password;
};

// "anhtuan@gmail.com" -> "a***n@gmail.com": đủ để người dùng nhận ra hộp thư mà không lộ cả địa chỉ
export const maskEmail = (email: string): string => {
    const at = email.lastIndexOf("@");
    if (at < 1) return "***";
    const local = email.slice(0, at);
    const domain = email.slice(at);
    return local.length <= 2 ? `${local[0]}***${domain}` : `${local[0]}***${local[local.length - 1]}${domain}`;
};

