import mongoose, { type Document, type Types } from "mongoose";
import type { ConfiguredGameName } from "../config/games.js";
import type { RoundRules } from "../services/gameRules.service.js";

export interface RoomPlayer {
    userId: Types.ObjectId;
    // Chụp lại lúc vào phòng để không phải tra user mỗi lần đọc phòng
    username: string;
    avatarUrl: string | null;
    ready: boolean;
    joinedAt: Date;
}

export interface RoomAnswer {
    enteredRecallAt: Date | null;
    memorizeUsedMs: number | null;
    submittedAt: Date | null;
    answers: (string | null)[] | null;
    correct: number | null;
    usedMs: number | null;
    participated: boolean;
}

export interface RoomRound {
    items: string[];
    recallOptions: string[];
    startedAt: Date;
    memorizeEndsAt: Date;
    recallEndsAt: Date;
    // Khoá là userId dạng chuỗi
    answers: Record<string, RoomAnswer>;
    // userId người thắng vòng, "draw" hoặc null khi chưa có kết quả
    outcome: string | null;
    resultAt: Date | null;
}

export type RoomState = "waiting" | "memorizing" | "recalling" | "round_result" | "completed" | "cancelled";

export interface GameRoomDocument extends Document {
    _id: Types.ObjectId;
    code: string;
    hostId: Types.ObjectId;
    capacity: number;
    players: RoomPlayer[];
    gameName: ConfiguredGameName;
    rules: RoundRules;
    roundCount: number;
    roundIndex: number;
    state: RoomState;
    rounds: RoomRound[];
    revision: number;
    expiresAt: Date;
    createdAt: Date;
}

const playerSchema = new mongoose.Schema<RoomPlayer>({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    username: { type: String, required: true },
    avatarUrl: { type: String, default: null },
    ready: { type: Boolean, default: false },
    joinedAt: { type: Date, required: true },
}, { _id: false });

const schema = new mongoose.Schema<GameRoomDocument>({
    code: { type: String, required: true, unique: true },
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    capacity: { type: Number, required: true, default: 2 },
    players: { type: [playerSchema], default: [] },
    gameName: { type: String, required: true },
    rules: { type: mongoose.Schema.Types.Mixed, required: true },
    roundCount: { type: Number, required: true, min: 1, max: 10 },
    roundIndex: { type: Number, default: -1 },
    state: { type: String, required: true, default: "waiting" },
    rounds: { type: mongoose.Schema.Types.Mixed, default: [] },
    revision: { type: Number, default: 0 },
    // Gia hạn mỗi khi phòng có thay đổi; phòng bỏ không 24 giờ thì tự xoá
    expiresAt: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false }, collection: "game_rooms" });

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ "players.userId": 1 });

export default mongoose.model<GameRoomDocument>("game_room", schema);
