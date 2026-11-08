import { randomBytes } from "node:crypto";
import type { Request } from "express";
import { StatusCodes } from "http-status-codes";
import ApiError from "./ApiError.js";
import { GUEST_COOKIE } from "./cookies.js";

// Người chơi của một request: tài khoản đã đăng nhập, hoặc khách nhận diện bằng cookie guestId
export type PlayerRef = { userId: string } | { guestId: string };

// 24 byte ngẫu nhiên mã hoá base64url: đủ khó đoán để không chiếm được ván của khách khác
const GUEST_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export const createGuestId = (): string => randomBytes(24).toString("base64url");

// Id của người dùng đã qua middleware xác thực
export const requireUserId = (request: Request): string => {
    if (!request.user) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized");
    }
    return request.user._id.toString();
};

// App mobile gửi "X-Client: mobile": token và guestId đi trong body/header thay vì cookie
export const isMobileClient = (request: Request): boolean =>
    request.get("X-Client")?.toLowerCase() === "mobile";

// App mobile gửi lại guestId đã nhận ở lần chơi đầu qua header này
export const GUEST_HEADER = "X-Guest-Id";

// null: khách chưa từng chơi (chưa có cookie hoặc header hợp lệ)
export const readPlayer = (request: Request): PlayerRef | null => {
    if (request.user) {
        return { userId: request.user._id.toString() };
    }
    const guestId: unknown = request.cookies?.[GUEST_COOKIE] ?? request.get(GUEST_HEADER);
    return typeof guestId === "string" && GUEST_ID_PATTERN.test(guestId) ? { guestId } : null;
};

export const routeParam = (request: Request, name: string): string => {
    const value = request.params[name];
    return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
};
