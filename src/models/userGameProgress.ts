import mongoose, { type Document, type Types } from "mongoose";
import { CONFIGURED_GAME_NAMES, type ConfiguredGameName } from "../config/games.js";
import type { GameRecords } from "../services/progression.service.js";

export interface GameStats {
    played: number;
    perfect: number;
    pass: number;
    fail: number;
    // Độ chính xác của game = totalCorrect / totalItems, để ván nhiều item có trọng số lớn hơn
    totalItems: number;
    totalCorrect: number;
    totalMemorizeSec: number;
    totalRecallSec: number;
    lastPlayedAt: Date | null;
}

// Tiến độ của một người chơi trong một game
export interface GameProgress {
    // Level cao nhất đã mở, bắt đầu từ 1
    unlockedLevel: number;
    stats: GameStats;
    records: GameRecords;
}

export interface UserGameProgressDocument extends Document, GameProgress {
    userId: Types.ObjectId;
    gameName: ConfiguredGameName;
}

const counter = () => ({ type: Number, default: 0, min: 0 });

const gameStatsSchema = new mongoose.Schema<GameStats>(
    {
        played: counter(),
        perfect: counter(),
        pass: counter(),
        fail: counter(),
        totalItems: counter(),
        totalCorrect: counter(),
        totalMemorizeSec: counter(),
        totalRecallSec: counter(),
        lastPlayedAt: { type: Date, default: null },
    },
    { _id: false },
);

const gameRecordsSchema = new mongoose.Schema<GameRecords>(
    {
        bestLevel: { type: Number, default: null, min: 1 },
        // Khoá là level dạng chuỗi ("1", "2", ...), giá trị là số giây ghi nhớ
        fastestMemorizeSecByLevel: { type: Map, of: Number, default: () => new Map() },
    },
    { _id: false },
);

const userGameProgressSchema = new mongoose.Schema<UserGameProgressDocument>(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "user",
            required: true,
        },
        gameName: {
            type: String,
            required: true,
            enum: CONFIGURED_GAME_NAMES,
        },
        unlockedLevel: { type: Number, default: 1, min: 1 },
        stats: { type: gameStatsSchema, default: () => ({}) },
        records: { type: gameRecordsSchema, default: () => ({}) },
    },
    { timestamps: true, collection: "user_game_progress" },
);

// Mỗi người chơi chỉ có một bản ghi tiến độ cho mỗi game
userGameProgressSchema.index({ userId: 1, gameName: 1 }, { unique: true });

const UserGameProgress = mongoose.model<UserGameProgressDocument>("user_game_progress", userGameProgressSchema);
export default UserGameProgress;
