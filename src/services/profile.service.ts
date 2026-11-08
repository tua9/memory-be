import { StatusCodes } from "http-status-codes";
import {
  DAILY_MINUTES_OPTIONS,
  TARGET_DATE_MAX_YEARS,
  TRAINING_GOALS,
  type DailyMinutes,
  type TrainingGoal,
} from "../config/preferences.js";
import { PROGRESS_TIME_ZONE } from "../config/progression.js";
import User, { type UserDocument, type UserPreferences, type UserProgress } from "../models/user.js";
import ApiError from "../utils/ApiError.js";
import { addDaysToDateKey, toDateKey } from "../utils/date.js";
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
  preferences: PreferencesView;
}

// unset: chưa trả lời và chưa bỏ qua, giao diện sẽ hỏi một lần; đã trả lời thì bỏ qua sau đó không đổi trạng thái
export type PreferencesStatus = "unset" | "answered" | "skipped";

export interface PreferencesView {
  goals: TrainingGoal[];
  dailyMinutes: DailyMinutes | null;
  targetDate: string | null;
  status: PreferencesStatus;
}

export interface PreferencesInput {
  goals: TrainingGoal[];
  dailyMinutes: DailyMinutes;
  targetDate: string | null;
}

// Tài khoản tạo trước khi có tiến độ hoặc mục tiêu có thể chưa có hai trường này
export type ProfileSource = Pick<UserDocument, "username"> & {
  progress?: UserProgress;
  preferences?: Partial<UserPreferences> | null;
};

export interface UserProfileRepository {
  updateUsername(
    userId: string,
    username: string,
  ): Promise<ProfileSource | null>;
  savePreferences(
    userId: string,
    preferences: PreferencesInput,
    answeredAt: Date,
  ): Promise<ProfileSource | null>;
  skipPreferences(userId: string, skippedAt: Date): Promise<ProfileSource | null>;
}

export interface UserProfileService {
  getProfile(user: ProfileSource, now?: Date): UserProfile;
  updateProfile(userId: string, body: unknown): Promise<UserProfile>;
  savePreferences(userId: string, body: unknown, now?: Date): Promise<UserProfile>;
  skipPreferences(userId: string, now?: Date): Promise<UserProfile>;
}

export const unavailableProfileFields = ["fullname"] as const;

const toPreferencesView = (preferences: ProfileSource["preferences"]): PreferencesView => ({
  goals: [...(preferences?.goals ?? [])],
  dailyMinutes: preferences?.dailyMinutes ?? null,
  targetDate: preferences?.targetDate ?? null,
  status: preferences?.answeredAt
    ? "answered"
    : preferences?.skippedAt
      ? "skipped"
      : "unset",
});

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
    preferences: toPreferencesView(user.preferences),
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
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "At least one supported profile field is required",
    );
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
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Username must be 2-100 characters",
    );
  }

  return normalizedUsername;
};

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PREFERENCE_FIELDS = ["goals", "dailyMinutes", "targetDate"];

const badRequest = (message: string) => new ApiError(StatusCodes.BAD_REQUEST, message);

// Ngày thi: một ngày có thật, từ hôm nay (theo PROGRESS_TIME_ZONE) tới tối đa TARGET_DATE_MAX_YEARS năm sau
const getTargetDate = (value: unknown, now: Date): string | null => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !DATE_KEY_PATTERN.test(value) || addDaysToDateKey(value, 0) !== value) {
    throw badRequest("targetDate must be a date in YYYY-MM-DD format");
  }

  const today = toDateKey(now, PROGRESS_TIME_ZONE);
  const latest = `${Number(today.slice(0, 4)) + TARGET_DATE_MAX_YEARS}${today.slice(4)}`;
  if (value < today || value > latest) {
    throw badRequest(`targetDate must be between today and ${TARGET_DATE_MAX_YEARS} years from now`);
  }
  return value;
};

const getPreferences = (body: unknown, now: Date): PreferencesInput => {
  if (!isRecord(body)) {
    throw badRequest("A JSON object is required");
  }

  const unsupportedFields = Object.keys(body).filter((field) => !PREFERENCE_FIELDS.includes(field));
  if (unsupportedFields.length > 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Unsupported preference field(s): ${unsupportedFields.join(", ")}`,
      unsupportedFields,
      "UNSUPPORTED_PREFERENCE_FIELD",
    );
  }

  const { goals, dailyMinutes } = body;
  if (
    !Array.isArray(goals)
    || goals.length === 0
    || !goals.every((goal) => TRAINING_GOALS.includes(goal as TrainingGoal))
  ) {
    throw badRequest(`goals must be a non-empty list of: ${TRAINING_GOALS.join(", ")}`);
  }
  if (!DAILY_MINUTES_OPTIONS.includes(dailyMinutes as DailyMinutes)) {
    throw badRequest(`dailyMinutes must be one of: ${DAILY_MINUTES_OPTIONS.join(", ")}`);
  }

  // Bỏ mục trùng và lưu theo thứ tự cố định, không phụ thuộc thứ tự người dùng bấm
  const uniqueGoals = TRAINING_GOALS.filter((goal) => goals.includes(goal));
  const targetDate = getTargetDate(body.targetDate, now);

  return {
    goals: uniqueGoals,
    dailyMinutes: dailyMinutes as DailyMinutes,
    targetDate: uniqueGoals.includes("exam") ? targetDate : null,
  };
};

const PROFILE_FIELDS = "username progress preferences";

const defaultRepository: UserProfileRepository = {
  updateUsername: async (userId, username) =>
    User.findByIdAndUpdate(
      userId,
      { $set: { username } },
      { new: true, runValidators: true },
    )
      .select(PROFILE_FIELDS)
      .exec(),
  savePreferences: async (userId, preferences, answeredAt) =>
    User.findByIdAndUpdate(
      userId,
      {
        $set: {
          "preferences.goals": preferences.goals,
          "preferences.dailyMinutes": preferences.dailyMinutes,
          "preferences.targetDate": preferences.targetDate,
          "preferences.answeredAt": answeredAt,
        },
      },
      { new: true, runValidators: true },
    )
      .select(PROFILE_FIELDS)
      .exec(),
  skipPreferences: async (userId, skippedAt) =>
    User.findByIdAndUpdate(
      userId,
      { $set: { "preferences.skippedAt": skippedAt } },
      { new: true },
    )
      .select(PROFILE_FIELDS)
      .exec(),
};

const requireOwner = (user: ProfileSource | null): ProfileSource => {
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Profile owner was not found");
  }
  return user;
};

export const createUserProfileService = (
  repository: UserProfileRepository = defaultRepository,
): UserProfileService => ({
  getProfile: toUserProfile,
  updateProfile: async (userId, body) => {
    const username = getUsername(body);
    const updatedUser = await repository.updateUsername(userId, username);
    return toUserProfile(requireOwner(updatedUser));
  },
  savePreferences: async (userId, body, now = new Date()) => {
    const preferences = getPreferences(body, now);
    const updatedUser = await repository.savePreferences(userId, preferences, now);
    return toUserProfile(requireOwner(updatedUser), now);
  },
  skipPreferences: async (userId, now = new Date()) => {
    const updatedUser = await repository.skipPreferences(userId, now);
    return toUserProfile(requireOwner(updatedUser), now);
  },
});

export const userProfileService = createUserProfileService();
