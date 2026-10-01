import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { env } from "../config/env.js";
import User, { type UserDocument } from "../models/user.js";
import { JwtProvider } from "../providers/JwtProvider.js";
import ApiError from "../utils/ApiError.js";
import { asyncHandler } from "./asyncHandler.js";

declare global {
    namespace Express {
        interface Request {
            user?: UserDocument;
        }
    }
}

export const AUTH_ERROR_CODES = {
    TOKEN_EXPIRED: "TOKEN_EXPIRED",
} as const;

export const protectedRoute: RequestHandler = asyncHandler(async (request, _response, next) => {
    const accessToken: unknown = request.cookies?.accessToken;
    if (typeof accessToken !== "string" || !accessToken) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized");
    }
    if (!env.ACCESS_TOKEN_SECRET) {
        throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, "Access token secret must be configured");
    }

    let payload;
    try {
        payload = await JwtProvider.verifyToken(accessToken, env.ACCESS_TOKEN_SECRET);
    } catch (error) {
        if (error instanceof Error && error.name === "TokenExpiredError") {
            // The code lets clients tell "refresh and retry" apart from "sign in again".
            throw new ApiError(StatusCodes.UNAUTHORIZED, "Access token expired", [], AUTH_ERROR_CODES.TOKEN_EXPIRED);
        }
        if (error instanceof Error && ["JsonWebTokenError", "NotBeforeError"].includes(error.name)) {
            throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid access token");
        }
        throw error;
    }

    if (payload.tokenType !== "access" || typeof payload.sub !== "string" || !/^[a-f\d]{24}$/i.test(payload.sub)) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid access token");
    }

    const user = await User.findById(payload.sub).select("-passwordHash");
    if (!user) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, "User not found");
    }
    if (user.status !== "active") {
        throw new ApiError(StatusCodes.FORBIDDEN, "Account is not active");
    }

    request.user = user;
    next();
});