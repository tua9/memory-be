import type { CookieOptions, Response } from "express";
import { GUEST_PROGRESS_TTL_SEC } from "../config/games.js";
import { env } from "../config/env.js";

// Cookie httpOnly dùng chung cho phiên đăng nhập và định danh khách
export const baseCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.IS_PRODUCTION,
  sameSite: "none",
  path: "/",
};

export const GUEST_COOKIE = "guestId";

// Gia hạn mỗi lần khách bắt đầu ván, cùng thời hạn với tiến độ tạm của khách ở backend
export const setGuestCookie = (response: Response, guestId: string): void => {
  response.cookie(GUEST_COOKIE, guestId, {
    ...baseCookieOptions,
    maxAge: GUEST_PROGRESS_TTL_SEC * 1000,
  });
};
