import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { asyncHandler } from "../middlewares/asyncHandler.js";
import type { UserProfileService } from "../services/profile.service.js";
import { unavailableProfileFields, userProfileService } from "../services/profile.service.js";
import ApiError from "../utils/ApiError.js";

export const createUserProfileController = (
    service: UserProfileService = userProfileService,
): { getProfile: RequestHandler; updateProfile: RequestHandler } => ({
    getProfile: asyncHandler(async (request, response) => {
        const user = request.user;
        if (!user) {
            throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized");
        }

        response.status(StatusCodes.OK).json({
            status: "success",
            data: {
                profile: service.getProfile(user),
                unavailableFields: unavailableProfileFields,
            },
        });
    }),
    updateProfile: asyncHandler(async (request, response) => {
        const user = request.user;
        if (!user) {
            throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized");
        }

        const profile = await service.updateProfile(user._id.toString(), request.body);
        response.status(StatusCodes.OK).json({
            status: "success",
            message: "Profile updated successfully",
            data: { profile, unavailableFields: unavailableProfileFields },
        });
    }),
});