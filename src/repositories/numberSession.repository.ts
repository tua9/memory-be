import mongoose from "mongoose";
import NumberSession, {
    type NumberGameMode,
    type NumberSessionDocument,
    type NumberSessionPhase,
} from "../models/numberSession.js";

export interface CreateNumberSessionData {
    userId: string | mongoose.Types.ObjectId;
    mode: NumberGameMode;
    level: number | null;
    challengeDate: string | null;
    digitCount: number;
    memorizeSeconds: number;
    recallSeconds: number;
    originalDigits: string[];
    answers: (string | null)[];
    phase: NumberSessionPhase;
    revision: number;
    startedAt: Date;
    memorizeEndsAt: Date;
}

export interface CompleteSessionData {
    phase: "completed";
    completionReason: "submitted" | "timeout";
    completedAt: Date;
    correctCount: number;
    wrongCount: number;
    blankCount: number;
    score: number;
    accuracy: number;
    memorizeUsedMs?: number | null;
    recallStartedAt?: Date | null;
    recallEndsAt?: Date | null;
    answers?: (string | null)[];
}

export interface HistoryQueryOptions {
    page: number;
    limit: number;
    mode?: NumberGameMode;
    phase?: NumberSessionPhase;
}

export interface NumberSessionRepository {
    create(data: CreateNumberSessionData): Promise<NumberSessionDocument>;
    findByIdAndUser(id: string, userId: string): Promise<NumberSessionDocument | null>;
    findById(id: string): Promise<NumberSessionDocument | null>;
    updateAnswersWithRevision(
        id: string,
        userId: string,
        revision: number,
        answers: (string | null)[],
    ): Promise<NumberSessionDocument | null>;
    transitionToRecalling(
        id: string,
        userId: string,
        recallStartedAt: Date,
        recallEndsAt: Date,
        memorizeUsedMs: number,
    ): Promise<NumberSessionDocument | null>;
    completeSession(
        id: string,
        userId: string,
        expectedRevision: number | null,
        data: CompleteSessionData,
    ): Promise<NumberSessionDocument | null>;
    completeExpiredSessionById(
        id: string,
        data: CompleteSessionData,
    ): Promise<NumberSessionDocument | null>;
    transitionExpiredMemorizingToRecalling(
        id: string,
        recallStartedAt: Date,
        recallEndsAt: Date,
        memorizeUsedMs: number,
    ): Promise<NumberSessionDocument | null>;
    findHistory(
        userId: string,
        options: HistoryQueryOptions,
    ): Promise<{ items: NumberSessionDocument[]; total: number }>;
    findExpiredCandidates(now: Date, limit: number): Promise<NumberSessionDocument[]>;
    // Cấp cao nhất người chơi từng nhớ đúng hết; null khi chưa có ván hoàn hảo nào theo cấp
    findHighestPerfectLevel(userId: string): Promise<number | null>;
    // Ván thử thách của người chơi trong một ngày "YYYY-MM-DD"
    findChallengeOn(userId: string, challengeDate: string): Promise<NumberSessionDocument | null>;
}

export class MongoNumberSessionRepository implements NumberSessionRepository {
    async create(data: CreateNumberSessionData): Promise<NumberSessionDocument> {
        return NumberSession.create(data);
    }

    async findByIdAndUser(id: string, userId: string): Promise<NumberSessionDocument | null> {
        if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(userId)) {
            return null;
        }
        return NumberSession.findOne({ _id: id, userId }).exec();
    }

    async findById(id: string): Promise<NumberSessionDocument | null> {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return null;
        }
        return NumberSession.findById(id).exec();
    }

    async updateAnswersWithRevision(
        id: string,
        userId: string,
        revision: number,
        answers: (string | null)[],
    ): Promise<NumberSessionDocument | null> {
        if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(userId)) {
            return null;
        }

        return NumberSession.findOneAndUpdate(
            {
                _id: id,
                userId,
                phase: "recalling",
                revision,
            },
            {
                $set: { answers },
                $inc: { revision: 1 },
            },
            { returnDocument: "after" },
        ).exec();
    }

    async transitionToRecalling(
        id: string,
        userId: string,
        recallStartedAt: Date,
        recallEndsAt: Date,
        memorizeUsedMs: number,
    ): Promise<NumberSessionDocument | null> {
        if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(userId)) {
            return null;
        }

        return NumberSession.findOneAndUpdate(
            {
                _id: id,
                userId,
                phase: "memorizing",
            },
            {
                $set: {
                    phase: "recalling",
                    recallStartedAt,
                    recallEndsAt,
                    memorizeUsedMs,
                },
                $inc: { revision: 1 },
            },
            { returnDocument: "after" },
        ).exec();
    }

    async completeSession(
        id: string,
        userId: string,
        expectedRevision: number | null,
        data: CompleteSessionData,
    ): Promise<NumberSessionDocument | null> {
        if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(userId)) {
            return null;
        }

        const filter: Record<string, unknown> = {
            _id: id,
            userId,
            phase: "recalling",
        };

        if (typeof expectedRevision === "number") {
            filter.revision = expectedRevision;
        }

        return NumberSession.findOneAndUpdate(
            filter,
            {
                $set: data,
                $inc: { revision: 1 },
            },
            { returnDocument: "after" },
        ).exec();
    }

    async completeExpiredSessionById(
        id: string,
        data: CompleteSessionData,
    ): Promise<NumberSessionDocument | null> {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return null;
        }

        return NumberSession.findOneAndUpdate(
            {
                _id: id,
                phase: { $in: ["memorizing", "recalling"] },
            },
            {
                $set: data,
                $inc: { revision: 1 },
            },
            { returnDocument: "after" },
        ).exec();
    }

    async transitionExpiredMemorizingToRecalling(
        id: string,
        recallStartedAt: Date,
        recallEndsAt: Date,
        memorizeUsedMs: number,
    ): Promise<NumberSessionDocument | null> {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return null;
        }

        return NumberSession.findOneAndUpdate(
            {
                _id: id,
                phase: "memorizing",
            },
            {
                $set: {
                    phase: "recalling",
                    recallStartedAt,
                    recallEndsAt,
                    memorizeUsedMs,
                },
                $inc: { revision: 1 },
            },
            { returnDocument: "after" },
        ).exec();
    }

    async findHistory(
        userId: string,
        options: HistoryQueryOptions,
    ): Promise<{ items: NumberSessionDocument[]; total: number }> {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return { items: [], total: 0 };
        }

        const filter: Record<string, unknown> = { userId };
        if (options.mode) {
            filter.mode = options.mode;
        }
        if (options.phase) {
            filter.phase = options.phase;
        }

        const skip = (options.page - 1) * options.limit;

        const [items, total] = await Promise.all([
            NumberSession.find(filter)
                .select(
                    "mode digitCount memorizeSeconds recallSeconds phase revision startedAt completedAt completionReason score accuracy memorizeUsedMs createdAt updatedAt",
                )
                .sort({ createdAt: -1, _id: -1 })
                .skip(skip)
                .limit(options.limit)
                .exec(),
            NumberSession.countDocuments(filter).exec(),
        ]);

        return { items, total };
    }

    async findExpiredCandidates(now: Date, limit: number): Promise<NumberSessionDocument[]> {
        return NumberSession.find({
            $or: [
                { phase: "recalling", recallEndsAt: { $lte: now } },
                { phase: "memorizing", memorizeEndsAt: { $lte: now } },
            ],
        })
            .limit(limit)
            .exec();
    }

    async findHighestPerfectLevel(userId: string): Promise<number | null> {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return null;
        }
        const best = await NumberSession.findOne({
            userId,
            mode: "practice",
            phase: "completed",
            level: { $ne: null },
            $expr: { $eq: ["$correctCount", "$digitCount"] },
        })
            .sort({ level: -1 })
            .select("level")
            .lean<{ level: number }>()
            .exec();
        return best?.level ?? null;
    }

    async findChallengeOn(userId: string, challengeDate: string): Promise<NumberSessionDocument | null> {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return null;
        }
        return NumberSession.findOne({ userId, challengeDate }).exec();
    }
}

export const numberSessionRepository = new MongoNumberSessionRepository();
