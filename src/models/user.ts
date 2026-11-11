import mongoose, { type Document } from "mongoose";
import { DAILY_MINUTES_OPTIONS, TRAINING_GOALS, type DailyMinutes, type TrainingGoal } from "../config/preferences.js";
import type { StreakState } from "../services/streak.service.js";

export type UserStatus = "active" | "inactive" | "banned";
export type UserRole = "user" | "admin";
export type AuthProvider = "local" | "google";

// Tiến độ chung của tài khoản, cập nhật mỗi khi nộp xong một ván ở bất kỳ game nào.
// Cấp tài khoản không lưu ở đây mà tính từ exp mỗi lần đọc.
export interface UserProgress extends StreakState {
    exp: number;
    totalGames: number;
    totalPlayTimeSec: number;
}

// Mục tiêu luyện tập do người dùng tự khai; chưa trả lời lẫn chưa bỏ qua thì giao diện hỏi một lần
export interface UserPreferences {
    goals: TrainingGoal[];
    dailyMinutes: DailyMinutes | null;
    // "YYYY-MM-DD", chỉ có khi mục tiêu gồm "exam"
    targetDate: string | null;
    answeredAt: Date | null;
    skippedAt: Date | null;
}

export interface SavedCoachPlan {
    content: string;
    savedAt: Date;
}

export interface UserDocument extends Document {
    username: string;
    email: string;
    passwordHash: string | null;
    googleId?: string | null;
    avatarUrl?: string | null;
    authProvider: AuthProvider;
    isEmailVerified: boolean;
    status: UserStatus;
    role: UserRole;
    progress: UserProgress;
    preferences?: UserPreferences;
    coachPlan?: SavedCoachPlan | null;
}

const counter = () => ({ type: Number, default: 0, min: 0 });

const userProgressSchema = new mongoose.Schema<UserProgress>(
    {
        exp: counter(),
        currentStreak: counter(),
        longestStreak: counter(),
        // "YYYY-MM-DD" theo PROGRESS_TIME_ZONE
        lastPlayedDate: { type: String, default: null },
        totalGames: counter(),
        totalPlayTimeSec: counter(),
    },
    { _id: false },
);

const userPreferencesSchema = new mongoose.Schema<UserPreferences>(
    {
        goals: { type: [{ type: String, enum: TRAINING_GOALS }], default: [] },
        dailyMinutes: { type: Number, enum: [...DAILY_MINUTES_OPTIONS, null], default: null },
        targetDate: { type: String, default: null },
        answeredAt: { type: Date, default: null },
        skippedAt: { type: Date, default: null },
    },
    { _id: false },
);

const savedCoachPlanSchema = new mongoose.Schema<SavedCoachPlan>(
    {
        content: { type: String, required: true, trim: true, minlength: 1, maxlength: 3000 },
        savedAt: { type: Date, required: true },
    },
    { _id: false },
);

const userSchema = new mongoose.Schema<UserDocument>(
    {
        username: {
            type: String,
            required: true,
            trim: true,
            minlength: 2,
            maxlength: 100,
        },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
            index: true,
        },
        passwordHash: { type: String, default: null },
        googleId: { type: String, default: null },
        avatarUrl: { type: String, default: null },
        authProvider: {
            type: String,
            enum: ["local", "google"],
            default: "local",
        },
        isEmailVerified: {
            type: Boolean,
            default: false,
        },
        status: {
            type: String,
            enum: ["active", "inactive", "banned"],
            default: "active",
        },
        role: {
            type: String,
            enum: ["user", "admin"],
            default: "user",
        },
        progress: { type: userProgressSchema, default: () => ({}) },
        preferences: { type: userPreferencesSchema, default: () => ({}) },
        coachPlan: { type: savedCoachPlanSchema, default: null },
    },
    { timestamps: true },
);

userSchema.index(
    { googleId: 1 },
    {
        unique: true,
        partialFilterExpression: { googleId: { $type: "string" } },
    },
);

const User = mongoose.model<UserDocument>("user", userSchema);
export default User;