import { StatusCodes } from "http-status-codes";
import User, { type UserDocument } from "../models/user.js";
import ApiError from "../utils/ApiError.js";

export interface UserProfile {
    username: string;
    fullname: null;
    exp: number;
    streaks: number;
    streakExpired: boolean;
}

export interface UserProfileRepository {
    updateUsername(userId: string, username: string): Promise<Pick<UserDocument, "username" | "exp" | "streaks" | "lastActiveDate"> | null>;
}

export interface UserProfileService {
    getProfile(user: Pick<UserDocument, "username" | "exp" | "streaks" | "lastActiveDate">): UserProfile;
    updateProfile(userId: string, body: unknown): Promise<UserProfile>;
}

export const unavailableProfileFields = ["fullname"] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export const isPlayStreakExpired = (
    lastActiveDate: Date | null | undefined,
    now = new Date(),
): boolean => {
    if (!lastActiveDate) return false;

    const lastActiveDay = Date.UTC(
        lastActiveDate.getUTCFullYear(),
        lastActiveDate.getUTCMonth(),
        lastActiveDate.getUTCDate(),
    );
    const currentDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return currentDay - lastActiveDay > DAY_MS;
};

const toUserProfile = (user: Pick<UserDocument, "username" | "exp" | "streaks" | "lastActiveDate">): UserProfile => {
    const streakExpired = isPlayStreakExpired(user.lastActiveDate);
    return {
        username: user.username,
        fullname: null,
        exp: user.exp,
        streaks: streakExpired ? 0 : user.streaks,
        streakExpired,
    };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const getUsername = (body: unknown): string => {
    if (!isRecord(body)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "A JSON object is required");
    }

    const fields = Object.keys(body);
    if (fields.length === 0) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "At least one supported profile field is required");
    }

    const unsupportedFields = fields.filter((field) => field !== "username");
    if (unsupportedFields.length > 0) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            `Unsupported profile field(s): ${unsupportedFields.join(", ")}`,
            unsupportedFields,
            "UNSUPPORTED_PROFILE_FIELD",
        );
    }

    const username = body.username;
    if (typeof username !== "string") {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Username must be a string");
    }

    const normalizedUsername = username.trim();
    if (normalizedUsername.length < 2 || normalizedUsername.length > 100) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Username must be 2-100 characters");
    }

    return normalizedUsername;
};

const defaultRepository: UserProfileRepository = {
    updateUsername: async (userId, username) => User.findByIdAndUpdate(
        userId,
        { $set: { username } },
        { new: true, runValidators: true },
    ).select("username exp streaks lastActiveDate").exec(),
};

export const createUserProfileService = (
    repository: UserProfileRepository = defaultRepository,
): UserProfileService => ({
    getProfile: toUserProfile,
    updateProfile: async (userId, body) => {
        const username = getUsername(body);
        const updatedUser = await repository.updateUsername(userId, username);
        if (!updatedUser) {
            throw new ApiError(StatusCodes.NOT_FOUND, "Profile owner was not found");
        }
        return toUserProfile(updatedUser);
    },
});

export const userProfileService = createUserProfileService();