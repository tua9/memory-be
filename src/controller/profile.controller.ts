import type { Request, RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import type { UserDocument } from "../models/user.js";
import type { UserProfile, UserProfileService } from "../services/profile.service.js";
import { unavailableProfileFields, userProfileService } from "../services/profile.service.js";
import ApiError from "../utils/ApiError.js";

const requireUser = (request: Request): UserDocument => {
    if (!request.user) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized");
    }
    return request.user;
};

const profileBody = (profile: UserProfile) => ({ profile, unavailableFields: unavailableProfileFields });

export const createUserProfileController = (
    service: UserProfileService = userProfileService,
): {
    getProfile: RequestHandler;
    updateProfile: RequestHandler;
    savePreferences: RequestHandler;
    skipPreferences: RequestHandler;
} => ({
    getProfile: asyncHandler(async (request, response) => {
        const user = requireUser(request);
        response.status(StatusCodes.OK).json({
            status: "success",
            data: profileBody(service.getProfile(user)),
        });
    }),
    updateProfile: asyncHandler(async (request, response) => {
        const user = requireUser(request);
        const profile = await service.updateProfile(user._id.toString(), request.body);
        response.status(StatusCodes.OK).json({
            status: "success",
            message: "Profile updated successfully",
            data: profileBody(profile),
        });
    }),
    // Lưu mục tiêu luyện tập; trả về cả hồ sơ để giao diện cập nhật một lần
    savePreferences: asyncHandler(async (request, response) => {
        const user = requireUser(request);
        const profile = await service.savePreferences(user._id.toString(), request.body);
        response.status(StatusCodes.OK).json({
            status: "success",
            message: "Preferences saved successfully",
            data: profileBody(profile),
        });
    }),
    // Người dùng không muốn trả lời: ghi lại để không hỏi lại, vẫn sửa được trong trang hồ sơ
    skipPreferences: asyncHandler(async (request, response) => {
        const user = requireUser(request);
        const profile = await service.skipPreferences(user._id.toString());
        response.status(StatusCodes.OK).json({
            status: "success",
            message: "Preferences skipped",
            data: profileBody(profile),
        });
    }),
});
