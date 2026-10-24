import mongoose, { type Document, type Types } from "mongoose";
import {
    CONFIGURED_GAME_NAMES,
    GAME_MODES,
    GAME_RESULTS,
    type ConfiguredGameName,
    type GameResult,
} from "../config/games.js";
import type { RoundRewards, StoredRoundRules } from "../services/roundSettlement.service.js";

// memorizing → recalling → completed; ván quá hạn chuyển sang expired
export const GAME_SESSION_STATUSES = ["memorizing", "recalling", "completed", "expired"] as const;
export type GameSessionStatus = (typeof GAME_SESSION_STATUSES)[number];

// Một ván chơi. Mọi mốc thời gian và kết quả đều do server ghi, client không gửi lên.
export interface GameSessionData {
    userId: Types.ObjectId;
    gameName: ConfiguredGameName;
    status: GameSessionStatus;
    rules: StoredRoundRules;
    // Đáp án theo đúng thứ tự. Không được trả về mặc định, phải chọn "+items" khi query.
    items: string[];
    // Câu trả lời theo vị trí, null là bỏ trống; chỉ có khi đã nộp bài
    answers?: (string | null)[];
    startedAt: Date;
    recallStartedAt: Date | null;
    completedAt: Date | null;
    memorizeSec: number | null;
    recallSec: number | null;
    correctItems: number | null;
    accuracy: number | null;
    result: GameResult | null;
    rewards: RoundRewards | null;
    // Hạn tự xoá của ván chưa nộp; bỏ đi khi ván hoàn thành
    expiresAt?: Date;
}

export interface GameSessionDocument extends Document, GameSessionData {}

const roundRulesSchema = new mongoose.Schema<StoredRoundRules>(
    {
        mode: { type: String, enum: GAME_MODES, required: true },
        // null với ván tự chọn số lượng
        gameLevel: { type: Number, default: null, min: 1 },
        totalItems: { type: Number, required: true, min: 1 },
        memorizeLimitSec: { type: Number, required: true, min: 1 },
        recallLimitSec: { type: Number, required: true, min: 1 },
        passAccuracy: { type: Number, required: true, min: 0, max: 1 },
    },
    { _id: false },
);

const gameSessionSchema = new mongoose.Schema<GameSessionDocument>(
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
        status: {
            type: String,
            required: true,
            enum: GAME_SESSION_STATUSES,
            default: "memorizing",
        },
        rules: { type: roundRulesSchema, required: true },
        items: { type: [String], required: true, select: false },
        answers: { type: [String], default: undefined },
        startedAt: { type: Date, required: true },
        recallStartedAt: { type: Date, default: null },
        completedAt: { type: Date, default: null },
        memorizeSec: { type: Number, default: null, min: 0 },
        recallSec: { type: Number, default: null, min: 0 },
        correctItems: { type: Number, default: null, min: 0 },
        accuracy: { type: Number, default: null, min: 0, max: 1 },
        result: { type: String, enum: GAME_RESULTS, default: null },
        // Bản chụp phần thưởng lúc nộp bài, chỉ ghi một lần nên không cần schema chi tiết
        rewards: { type: mongoose.Schema.Types.Mixed, default: null },
        expiresAt: { type: Date },
    },
    { collection: "game_sessions" },
);

// Ván chưa nộp tự bị xoá khi tới expiresAt; ván đã hoàn thành không còn trường này nên được giữ lại
gameSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Lịch sử ván của một người chơi, mới nhất trước, có hoặc không lọc theo game
gameSessionSchema.index({ userId: 1, status: 1, completedAt: -1 });
gameSessionSchema.index({ userId: 1, gameName: 1, status: 1, completedAt: -1 });

const GameSession = mongoose.model<GameSessionDocument>("game_session", gameSessionSchema);
export default GameSession;
