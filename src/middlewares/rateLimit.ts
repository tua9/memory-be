import { rateLimit, type AugmentedRequest } from "express-rate-limit";
import { StatusCodes } from "http-status-codes";
import { PASSWORD_RESET_ERROR_CODES } from "../config/passwordReset.js";
import ApiError from "../utils/ApiError.js";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

// Lỗi đi qua errorHandlingMiddleware như mọi lỗi khác, cùng mã với giới hạn theo tài khoản để frontend xử lý chung
const createIpLimiter = (limit: number) =>
    rateLimit({
        windowMs: FIFTEEN_MINUTES_MS,
        limit,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        handler: (request, _response, next) => {
            const resetAt = (request as AugmentedRequest).rateLimit?.resetTime?.getTime() ?? Date.now() + FIFTEEN_MINUTES_MS;
            const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
            next(new ApiError(
                StatusCodes.TOO_MANY_REQUESTS,
                "Too many requests. Please try again later",
                [{ retryAfterSeconds }],
                PASSWORD_RESET_ERROR_CODES.RATE_LIMITED,
            ));
        },
    });

// Giới hạn theo tài khoản (passwordReset.service.ts) không chặn được một người nhắm vào nhiều email cùng lúc.
// /forgot gửi email nên chặt hơn; validate/confirm công khai nên vẫn cần chặn dò token và tốn CPU bcrypt.
export const forgotPasswordIpLimiter = createIpLimiter(10);
export const passwordResetIpLimiter = createIpLimiter(30);
export const coachChatIpLimiter = createIpLimiter(20);

// Nhập mã liên kết gia đình và mã phòng đấu: mã ngắn nên phải chặn việc thử lần lượt từng mã
export const codeEntryIpLimiter = createIpLimiter(30);
