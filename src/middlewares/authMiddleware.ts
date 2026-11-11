import type { Request, RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { env } from "../config/env";
import User, { type UserDocument } from "../models/user";
import { JwtProvider } from "../providers/JwtProvider";
import ApiError from "../utils/ApiError";
import { asyncHandler } from "./asyncHandler";

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

// Tạm thời lấy accessToken từ cookie hoặc header Authorization
const readAccessToken = (request: Request): unknown =>
  request.cookies?.accessToken || request.headers?.authorization?.split(" ")[1];

export const protectedRoute: RequestHandler = asyncHandler(
  async (request, _response, next) => {
    const accessToken = readAccessToken(request);
    if (typeof accessToken !== "string" || !accessToken) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized");
    }
    if (!env.ACCESS_TOKEN_SECRET) {
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "Access token secret must be configured",
      );
    }

    let payload;
    try {
      payload = await JwtProvider.verifyToken(
        accessToken,
        env.ACCESS_TOKEN_SECRET,
      );
    } catch (error) {
      if (error instanceof Error && error.name === "TokenExpiredError") {
        // The code lets clients tell "refresh and retry" apart from "sign in again".
        throw new ApiError(
          StatusCodes.UNAUTHORIZED,
          "Access token expired",
          [],
          AUTH_ERROR_CODES.TOKEN_EXPIRED,
        );
      }
      if (
        error instanceof Error &&
        ["JsonWebTokenError", "NotBeforeError"].includes(error.name)
      ) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid access token");
      }
      throw error;
    }

    if (
      payload.tokenType !== "access" ||
      typeof payload.sub !== "string" ||
      !/^[a-f\d]{24}$/i.test(payload.sub)
    ) {
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
  },
);

// Cho API dùng chung giữa khách và người đã đăng nhập:
// - Không có phiên nào: coi là khách, request.user để trống.
// - Có access token: xác thực như protectedRoute (token hết hạn vẫn trả 401 để frontend refresh).
// - Chỉ còn refresh token (access token hết hạn nên trình duyệt đã xoá cookie): trả 401 TOKEN_EXPIRED
//   để frontend refresh rồi gọi lại, thay vì lặng lẽ coi người đã đăng nhập là khách.
export const optionalAuthentication: RequestHandler = (request, response, next) => {
  if (readAccessToken(request)) {
    protectedRoute(request, response, next);
    return;
  }
  if (request.cookies?.refreshToken) {
    next(
      new ApiError(
        StatusCodes.UNAUTHORIZED,
        "Access token expired",
        [],
        AUTH_ERROR_CODES.TOKEN_EXPIRED,
      ),
    );
    return;
  }
  next();
};
