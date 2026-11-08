import type { Request, RequestHandler, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authService, type AuthTokens } from "../services/user.service";
import ApiError from "../utils/ApiError";
import { baseCookieOptions } from "../utils/cookies";
import { isMobileClient } from "../utils/request";

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

// Web: token nằm trong cookie httpOnly, body chỉ có userInfo.
// App mobile (X-Client: mobile): không có cookie, token trả trong body để app tự lưu vào SecureStore.
const sendSession = (request: Request, response: Response, tokens: AuthTokens, message: string): void => {
    if (isMobileClient(request)) {
        response.status(StatusCodes.OK).json({
            status: "success",
            message,
            data: {
                userInfo: tokens.userInfo,
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                accessExpiresAt: tokens.accessExpiresAt,
                refreshExpiresAt: tokens.refreshExpiresAt,
            },
        });
        return;
    }
    setAuthCookies(response, tokens);
    response.status(StatusCodes.OK).json({
        status: "success",
        message,
        data: { userInfo: tokens.userInfo },
    });
};

// Mỗi loại client chỉ đọc đúng một nguồn: web không nhận refresh token từ body, mobile không dùng cookie
const readRefreshToken = (request: Request): unknown =>
    isMobileClient(request) ? request.body?.refreshToken : request.cookies?.refreshToken;

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
    sendSession(request, response, tokens, "Sign in successful");
});

const clearAuthCookies = (response: Response): void => {
    response.clearCookie("accessToken", baseCookieOptions);
    response.clearCookie("refreshToken", baseCookieOptions);
};

export const refresh: RequestHandler = asyncHandler(async (request, response) => {
    let tokens: AuthTokens;
    try {
        tokens = await authService.refreshToken(readRefreshToken(request));
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
    sendSession(request, response, tokens, "Token refreshed");
});

export const signOut: RequestHandler = asyncHandler(async (request, response) => {
    await authService.signOut(readRefreshToken(request));
    clearAuthCookies(response);
    response.status(StatusCodes.OK).json({
        status: "success",
        message: "Sign out successful",
    });
});

export const googleAuth: RequestHandler = asyncHandler(async (request, response) => {
    // App mobile gửi idToken (Google Sign-In native); web gửi access token từ Google Identity Services
    const tokens = request.body?.idToken !== undefined
        ? await authService.googleSignInWithIdToken(request.body.idToken)
        : await authService.googleSignIn(request.body?.accessToken ?? request.body?.token);
    sendSession(request, response, tokens, "Google sign in successful");
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