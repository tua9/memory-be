import type { RequestHandler, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authService, type AuthTokens } from "../services/user.service";
import ApiError from "../utils/ApiError";
import { baseCookieOptions } from "../utils/cookies";

// Không chọn "Duy trì đăng nhập" thì bỏ expires: cookie thành session cookie,
// trình duyệt xóa khi đóng. Hạn thật của token vẫn do JWT và Session kiểm soát.
const setAuthCookies = (response: Response, tokens: AuthTokens): void => {
    response.cookie("accessToken", tokens.accessToken, {
        ...baseCookieOptions,
        ...(tokens.rememberMe && { expires: tokens.accessExpiresAt }),
    });
    response.cookie("refreshToken", tokens.refreshToken, {
        ...baseCookieOptions,
        ...(tokens.rememberMe && { expires: tokens.refreshExpiresAt }),
    });
};

export const signUp: RequestHandler = asyncHandler(async (request, response) => {
    const userInfo = await authService.signUp(request.body);
    response.status(StatusCodes.CREATED).json({
        status: "success",
        message: "Sign up successful",
        data: { userInfo },
    });
});

export const signIn: RequestHandler = asyncHandler(async (request, response) => {
    const tokens = await authService.signIn(request.body);
    setAuthCookies(response, tokens);
    response.status(StatusCodes.OK).json({
        status: "success",
        message: "Sign in successful",
        data: { userInfo: tokens.userInfo },
    });
});

const clearAuthCookies = (response: Response): void => {
    response.clearCookie("accessToken", baseCookieOptions);
    response.clearCookie("refreshToken", baseCookieOptions);
};

export const refresh: RequestHandler = asyncHandler(async (request, response) => {
    let tokens: AuthTokens;
    try {
        tokens = await authService.refreshToken(request.cookies?.refreshToken);
    } catch (error) {
        // Phiên không dùng được nữa (token sai, hết hạn, bị thu hồi hoặc tài khoản bị khoá): xoá cookie,
        // nếu không trình duyệt cứ gửi lại cookie cũ và mọi request sau đều phải thử refresh rồi thất bại
        if (
            error instanceof ApiError
            && (error.statusCode === StatusCodes.UNAUTHORIZED || error.statusCode === StatusCodes.FORBIDDEN)
        ) {
            clearAuthCookies(response);
        }
        throw error;
    }
    setAuthCookies(response, tokens);
    response.status(StatusCodes.OK).json({
        status: "success",
        message: "Token refreshed",
        data: { userInfo: tokens.userInfo },
    });
});

export const signOut: RequestHandler = asyncHandler(async (request, response) => {
    await authService.signOut(request.cookies?.refreshToken);
    clearAuthCookies(response);
    response.status(StatusCodes.OK).json({
        status: "success",
        message: "Sign out successful",
    });
});

export const googleAuth: RequestHandler = asyncHandler(async (request, response) => {
    const token = request.body?.accessToken ?? request.body?.token;
    const tokens = await authService.googleSignIn(token);
    setAuthCookies(response, tokens);
    response.status(StatusCodes.OK).json({
        status: "success",
        message: "Google sign in successful",
        data: { userInfo: tokens.userInfo },
    });
});

export const setPassword: RequestHandler = asyncHandler(async (request, response) => {
    const userId = request.user!._id.toString();
    await authService.setPassword(userId, request.body);
    response.status(StatusCodes.OK).json({
        status: "success",
        message: "Password set successfully",
    });
});

export const changePassword: RequestHandler = asyncHandler(async (request, response) => {
    const user = request.user;
    if (!user) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized");
    }
    await authService.changePassword(user._id.toString(), request.body);
    clearAuthCookies(response);
    response.status(StatusCodes.OK).json({
        status: "success",
        message: "Đổi mật khẩu thành công. Vui lòng đăng nhập lại.",
    });
});