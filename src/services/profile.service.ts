import { StatusCodes } from "http-status-codes";
import User, { type UserDocument, type UserProgress } from "../models/user.js";
import ApiError from "../utils/ApiError.js";
import { getUserLevel, type UserLevelInfo } from "./progression.service.js";
import { createInitialUserProgress } from "./roundSettlement.service.js";
import { getStreakStatus } from "./streak.service.js";

export interface UserProfile {
    username: string;
    fullname: null;
    exp: number;
    level: UserLevelInfo;
    // Chuỗi ngày chơi hiện tại; về 0 khi đã bỏ qua trọn một ngày
    streaks: number;
    longestStreak: number;
    // Đã có chuỗi nhưng vừa bị gián đoạn, để giao diện nhắc người chơi quay lại
    streakExpired: boolean;
    playedToday: boolean;
}

// Tài khoản tạo trước khi có tiến độ có thể chưa có trường progress
export type ProfileSource = Pick<UserDocument, "username"> & { progress?: UserProgress };

export interface UserProfileRepository {
    updateUsername(userId: string, username: string): Promise<ProfileSource | null>;
}

export interface UserProfileService {
    getProfile(user: ProfileSource, now?: Date): UserProfile;
    updateProfile(userId: string, body: unknown): Promise<UserProfile>;
}

export const unavailableProfileFields = ["fullname"] as const;

// EXP và streak chỉ đọc từ users.progress, được cập nhật khi nộp xong mỗi ván
const toUserProfile = (user: ProfileSource, now = new Date()): UserProfile => {
    const progress = user.progress ?? createInitialUserProgress();
    const streak = getStreakStatus(progress, now);
    return {
        username: user.username,
        fullname: null,
        exp: progress.exp,
        level: getUserLevel(progress.exp),
        streaks: streak.currentStreak,
        longestStreak: streak.longestStreak,
        streakExpired: progress.currentStreak > 0 && streak.currentStreak === 0,
        playedToday: streak.playedToday,
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
    ).select("username progress").exec(),
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
