import mongoose, { type Document } from "mongoose";
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