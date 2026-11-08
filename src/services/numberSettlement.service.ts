import { Types } from "mongoose";
import NumberSession, { type NumberSessionDocument } from "../models/numberSession.js";
import GameSession from "../models/gameSession.js";
import { findOwnSession, settleUserSession, type GameSessionRecord } from "./gameSession.service.js";

// Keep the revision-based Numbers lifecycle; settle its immutable completed snapshot through the shared transaction.
export const numberSettlementSnapshot = (source: NumberSessionDocument): GameSessionRecord => {
    if (source.phase !== "completed" || !source.completedAt || !source.recallStartedAt) throw new Error("Only completed number sessions can be recorded");
    return {
        _id: source._id,
        userId: new Types.ObjectId(String(source.userId)), guestId: null,
        gameName: "number", status: "recalling",
        rules: { mode: source.mode === "challenge" ? "daily" : source.level ? "level" : "custom", gameLevel: source.level ?? null,
            totalItems: source.digitCount, memorizeLimitSec: source.memorizeSeconds, recallLimitSec: source.recallSeconds, passAccuracy: 0.7 },
        items: [...source.originalDigits], answers: [...source.answers],
        startedAt: source.startedAt, recallStartedAt: source.recallStartedAt, completedAt: null,
        memorizeSec: null, recallSec: null, correctItems: null, accuracy: null, result: null,
        rewards: null, guestUnlockedLevel: null,
    };
};

export const recordNumberCompletion = async (source: NumberSessionDocument): Promise<void> => {
    if (!source.sharedProgress || source.progressRecordedAt || source.phase !== "completed") return;
    const snapshot = numberSettlementSnapshot(source);
    // The original _id is also the idempotency key. A retry reuses the same shared session.
    try {
        await GameSession.updateOne({ _id: snapshot._id }, { $setOnInsert: snapshot }, { upsert: true }).exec();
    } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
    }
    const userId = String(source.userId);
    const current = await findOwnSession({ userId }, String(source._id));
    if (current.gameName !== "number") throw new Error("Conflicting shared game session");
    if (current.status !== "completed") await settleUserSession(current, userId, source.answers, source.completedAt!);
    const recordedAt = new Date();
    await NumberSession.updateOne({ _id: source._id }, { $set: { progressRecordedAt: recordedAt } }).exec();
    source.progressRecordedAt = recordedAt;
};
