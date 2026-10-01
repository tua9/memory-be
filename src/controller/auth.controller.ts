import type { CookieOptions, RequestHandler, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { env } from "../config/env.js";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import { authService, type AuthTokens } from "../services/user.service.js";

const baseCookieOptions: CookieOptions = {
    httpOnly: true,
    secure: env.IS_PRODUCTION,
    sameSite: "lax",
    path: "/",
};

const setAuthCookies = (response: Response, tokens: AuthTokens): void => {
    response.cookie("accessToken", tokens.accessToken, {
        ...baseCookieOptions,
        expires: tokens.accessExpiresAt,
    });
    response.cookie("refreshToken", tokens.refreshToken, {
        ...baseCookieOptions,
        expires: tokens.refreshExpiresAt,
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

export const refresh: RequestHandler = asyncHandler(async (request, response) => {
    const tokens = await authService.refreshToken(request.cookies?.refreshToken);
    setAuthCookies(response, tokens);
    response.status(StatusCodes.OK).json({
        status: "success",
        message: "Token refreshed",
        data: { userInfo: tokens.userInfo },
    });
});

export const signOut: RequestHandler = asyncHandler(async (request, response) => {
    await authService.signOut(request.cookies?.refreshToken);
    response.clearCookie("accessToken", baseCookieOptions);
    response.clearCookie("refreshToken", baseCookieOptions);
    response.status(StatusCodes.OK).json({
        status: "success",
        message: "Sign out successful",
    });
});