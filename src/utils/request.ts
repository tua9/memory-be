import type { Request } from "express";
import { StatusCodes } from "http-status-codes";
import ApiError from "./ApiError.js";

// Id của người dùng đã qua middleware xác thực
export const requireUserId = (request: Request): string => {
    if (!request.user) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized");
    }
    return request.user._id.toString();
};

export const routeParam = (request: Request, name: string): string => {
    const value = request.params[name];
    return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
};
