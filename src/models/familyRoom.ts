import mongoose, { type Document, type Types } from "mongoose";
import type { ConfiguredGameName } from "../config/games.js";
import type { RoundRules } from "../services/gameRules.service.js";

export type RoomRole = "parent" | "child";
export interface RoomAnswer {
    enteredRecallAt: Date | null;
    memorizeUsedMs: number | null;
    submittedAt: Date | null;
    answers: (string | null)[] | null;
    correct: number | null;
    usedMs: number | null;
    participated: boolean;
}
export interface FamilyRound {
    items: string[];
    recallOptions: string[];
    startedAt: Date;
    memorizeEndsAt: Date;
    recallEndsAt: Date;
    players: Record<RoomRole, RoomAnswer>;
    outcome: RoomRole | "draw" | null;
    resultAt: Date | null;
}
export interface FamilyRoomDocument extends Document {
    _id: Types.ObjectId;
    code: string;
    parentId: Types.ObjectId;
    childUserId: Types.ObjectId;
    gameName: ConfiguredGameName;
    rules: RoundRules;
    roundCount: number;
    roundIndex: number;
    state: "waiting" | "memorizing" | "recalling" | "round_result" | "completed" | "cancelled";
    parentReady: boolean;
    childJoined: boolean;
    childReady: boolean;
    rounds: FamilyRound[];
    revision: number;
    expiresAt: Date;
    createdAt: Date;
}

const schema = new mongoose.Schema<FamilyRoomDocument>({
    code: { type: String, required: true, unique: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: "parent", required: true, index: true },
    childUserId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true, index: true },
    gameName: { type: String, required: true },
    rules: { type: mongoose.Schema.Types.Mixed, required: true },
    roundCount: { type: Number, required: true, min: 1, max: 10 },
    roundIndex: { type: Number, default: -1 },
    state: { type: String, required: true, default: "waiting" },
    parentReady: { type: Boolean, default: false },
    childJoined: { type: Boolean, default: false },
    childReady: { type: Boolean, default: false },
    rounds: { type: mongoose.Schema.Types.Mixed, default: [] },
    revision: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
}, { timestamps: true, collection: "family_rooms" });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ parentId: 1, createdAt: -1 });
export default mongoose.model<FamilyRoomDocument>("family_room", schema);
