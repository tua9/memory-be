import type { Request, RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { env } from "../config/env";
import User, { type UserDocument } from "../models/user";
import Parent, { type ParentDocument } from "../models/parent.js";
import { JwtProvider } from "../providers/JwtProvider";
import ApiError from "../utils/ApiError";
import { asyncHandler } from "./asyncHandler";

declare global {
  namespace Express {
    interface Request {
      user?: UserDocument;
      parent?: ParentDocument;
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
      payload.accountType === "parent" ||
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

export const parentRoute: RequestHandler = asyncHandler(async (request, _response, next) => {
  const token = readAccessToken(request);
  if (typeof token !== "string" || !token) throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized");
  let payload;
  try {
    payload = await JwtProvider.verifyToken(token, env.ACCESS_TOKEN_SECRET);
  } catch {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid or expired access token", [], AUTH_ERROR_CODES.TOKEN_EXPIRED);
  }
  if (payload.tokenType !== "access" || payload.accountType !== "parent" || typeof payload.sub !== "string" || !/^[a-f\d]{24}$/i.test(payload.sub)) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid parent token");
  }
  const parent = await Parent.findById(payload.sub);
  if (!parent) throw new ApiError(StatusCodes.UNAUTHORIZED, "Parent account not found");
  request.parent = parent;
  next();
});

export const verifiedParentRoute: RequestHandler = (request, response, next) => {
  parentRoute(request, response, (error?: unknown) => {
    if (error) return next(error);
    if (!request.parent?.emailVerifiedAt) return next(new ApiError(StatusCodes.FORBIDDEN, "Please verify your email first"));
    next();
  });
};

export const roomParticipantRoute: RequestHandler = (request, response, next) => {
  const token = readAccessToken(request);
  if (typeof token !== "string" || !token) return next(new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized"));
  void JwtProvider.verifyToken(token, env.ACCESS_TOKEN_SECRET).then((payload) => {
    if (payload.accountType === "parent") verifiedParentRoute(request, response, next);
    else protectedRoute(request, response, next);
  }).catch(() => next(new ApiError(StatusCodes.UNAUTHORIZED, "Invalid or expired access token", [], AUTH_ERROR_CODES.TOKEN_EXPIRED)));
};

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
