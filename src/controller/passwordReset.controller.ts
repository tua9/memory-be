import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import {
    passwordResetService,
    type PasswordResetService,
} from "../services/passwordReset.service.js";
import ApiError from "../utils/ApiError.js";

export const createPasswordResetController = (
    service: PasswordResetService = passwordResetService,
): Record<"requestLink" | "forgotPassword" | "validateToken" | "confirm", RequestHandler> => ({
    // Quên mật khẩu: công khai, người dùng gửi email để nhận link reset
    forgotPassword: asyncHandler(async (request, response) => {
        const result = await service.forgotPassword(request.body?.email);
        response.status(StatusCodes.OK).json({
            status: "success",
            message: result.message,
        });
    }),

    // Giữ để tương thích nếu còn request cũ
    requestLink: asyncHandler(async (request, response) => {
        const user = request.user;
        if (!user) throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized");
        const data = await service.requestLink({ id: user._id.toString(), email: user.email });
        response.status(StatusCodes.OK).json({
            status: "success",
            message: "Password reset link sent",
            data,
        });
    }),

    validateToken: asyncHandler(async (request, response) => {
        const data = await service.validateToken(request.body);
        response.status(StatusCodes.OK).json({ status: "success", data });
    }),

    confirm: asyncHandler(async (request, response) => {
        await service.confirm(request.body);
        response.status(StatusCodes.OK).json({
            status: "success",
            message: "Password updated. Please sign in again",
        });
    }),
});

