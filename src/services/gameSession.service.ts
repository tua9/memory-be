import { StatusCodes } from "http-status-codes";
import mongoose, { type Types } from "mongoose";
import {
    PHASE_GRACE_SEC,
    UNFINISHED_ROUND_TTL_SEC,
    type ConfiguredGameName,
    type GameResult,
} from "../config/games.js";
import { getGameEngine, parseAnswers, type GameEngine, type ItemView } from "../games/index.js";
import GameSession, { type GameSessionData, type GameSessionStatus } from "../models/gameSession.js";
import User, { type UserProgress } from "../models/user.js";
import UserGameProgress, { type GameProgress } from "../models/userGameProgress.js";
import ApiError from "../utils/ApiError.js";
import { parseGameName, resolveRoundRules } from "./gameRules.service.js";
import {
    compareAnswers,
    createInitialGameProgress,
    createInitialUserProgress,
    settleRound,
    type RoundRewards,
    type StoredRoundRules,
} from "./roundSettlement.service.js";

export type GameSessionRecord = GameSessionData & { _id: Types.ObjectId };

export interface RoundView {
    sessionId: string;
    gameName: ConfiguredGameName;
    status: GameSessionStatus;
    rules: StoredRoundRules;
}

export interface StartedRoundView extends RoundView {
    items: ItemView[];
    memorizeDeadline: Date;
}

export interface RecallRoundView extends RoundView {
    recallOptions: ItemView[];
    recallDeadline: Date;
}

export interface ItemResultView {
    expected: ItemView;
    answer: ItemView | null;
    correct: boolean;
}

export interface RoundResultView {
    correctItems: number;
    totalItems: number;
    accuracy: number;
    result: GameResult;
    memorizeSec: number;
    recallSec: number;
    perItem: ItemResultView[];
}

export interface CompletedRoundView extends RoundView {
    startedAt: Date;
    completedAt: Date;
    result: RoundResultView;
    rewards: RoundRewards;
}

export interface GameSessionService {
    startRound(userId: string, body: unknown): Promise<StartedRoundView>;
    startRecall(userId: string, sessionId: string): Promise<RecallRoundView>;
    submitRound(userId: string, sessionId: string, body: unknown): Promise<CompletedRoundView>;
}

// Báo hiệu một yêu cầu nộp khác của cùng ván đã chấm xong trước, để huỷ transaction đang chạy
class RoundAlreadySettledError extends Error {}

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

const addSeconds = (date: Date, seconds: number): Date => new Date(date.getTime() + seconds * 1000);

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const conflict = (message: string) => new ApiError(StatusCodes.CONFLICT, message);

const START_ROUND_FIELDS = ["gameName", "mode", "gameLevel", "itemCount", "memorizeSec"] as const;
const SUBMIT_ROUND_FIELDS = ["answers"] as const;

// Từ chối trường lạ để client gửi sai nhận lỗi rõ ràng, ví dụ frontend còn gọi API ghi ván kiểu cũ
// với userId, time, score thì không bị âm thầm tạo thành một ván mới
const parseBody = (body: unknown, allowedFields: readonly string[]): Record<string, unknown> => {
    if (!isRecord(body)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "A JSON object is required");
    }
    const unsupportedFields = Object.keys(body).filter((field) => !allowedFields.includes(field));
    if (unsupportedFields.length > 0) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            `Unsupported field(s): ${unsupportedFields.join(", ")}`,
            unsupportedFields,
            "UNSUPPORTED_FIELD",
        );
    }
    return body;
};

// Ván của người khác cũng trả 404 để không lộ là ván đó có tồn tại
export const findOwnSession = async (userId: string, sessionId: string): Promise<GameSessionRecord> => {
    const notFound = new ApiError(StatusCodes.NOT_FOUND, "Game session not found");
    if (!OBJECT_ID_PATTERN.test(sessionId)) {
        throw notFound;
    }
    const session = await GameSession.findOne({ _id: sessionId, userId })
        .select("+items")
        .lean<GameSessionRecord>()
        .exec();
    if (!session) {
        throw notFound;
    }
    return session;
};

const expireSession = async (sessionId: Types.ObjectId, fromStatus: GameSessionStatus): Promise<void> => {
    await GameSession.updateOne({ _id: sessionId, status: fromStatus }, { $set: { status: "expired" } }).exec();
};

export const toRoundView = (session: GameSessionRecord): RoundView => ({
    sessionId: session._id.toString(),
    gameName: session.gameName,
    status: session.status,
    rules: session.rules,
});

// Kết quả của một ván đã hoàn thành; thiếu trường nào nghĩa là dữ liệu hỏng chứ không phải lỗi của người dùng
export const requireCompletedResult = (session: GameSessionRecord) => {
    const { completedAt, memorizeSec, recallSec, correctItems, accuracy, result, rewards } = session;
    if (
        session.status !== "completed" || !completedAt || memorizeSec === null || recallSec === null
        || correctItems === null || accuracy === null || result === null || !rewards
    ) {
        throw new Error("Completed game session is missing its results");
    }
    return { completedAt, memorizeSec, recallSec, correctItems, accuracy, result, rewards };
};

const toRecallView = (session: GameSessionRecord, engine: GameEngine): RecallRoundView => {
    if (!session.recallStartedAt) {
        throw new Error("A recalling game session must have recallStartedAt");
    }
    return {
        ...toRoundView(session),
        recallOptions: engine.buildRecallOptions(session.items).map((code) => engine.toView(code)),
        recallDeadline: addSeconds(session.recallStartedAt, session.rules.recallLimitSec),
    };
};

// Dùng cho cả kết quả ngay sau khi nộp, nộp lại một ván đã chấm và trang chi tiết ván
export const toCompletedView = (session: GameSessionRecord): CompletedRoundView => {
    const { completedAt, memorizeSec, recallSec, correctItems, accuracy, result, rewards } =
        requireCompletedResult(session);

    const engine = getGameEngine(session.gameName);
    const perItem = compareAnswers(session.items, session.answers ?? []).map((item) => ({
        expected: engine.toView(item.expected),
        answer: item.answer === null ? null : engine.toView(item.answer),
        correct: item.correct,
    }));

    return {
        ...toRoundView(session),
        startedAt: session.startedAt,
        completedAt,
        result: {
            correctItems,
            totalItems: session.rules.totalItems,
            accuracy,
            result,
            memorizeSec,
            recallSec,
            perItem,
        },
        rewards,
    };
};

const startRound: GameSessionService["startRound"] = async (userId, rawBody) => {
    const body = parseBody(rawBody, START_ROUND_FIELDS);
    const gameName = parseGameName(body.gameName);
    const progress = await UserGameProgress.findOne({ userId, gameName })
        .select("unlockedLevel")
        .lean<Pick<GameProgress, "unlockedLevel">>()
        .exec();
    const { mode, gameLevel, totalItems, memorizeLimitSec, recallLimitSec, passAccuracy } =
        resolveRoundRules(gameName, body, progress?.unlockedLevel ?? 1);
    const rules: StoredRoundRules = { mode, gameLevel, totalItems, memorizeLimitSec, recallLimitSec, passAccuracy };

    const engine = getGameEngine(gameName);
    const items = engine.generateItems(totalItems);
    const startedAt = new Date();
    const session = await GameSession.create({
        userId,
        gameName,
        status: "memorizing",
        rules,
        items,
        startedAt,
        expiresAt: addSeconds(startedAt, UNFINISHED_ROUND_TTL_SEC),
    });

    return {
        sessionId: session._id.toString(),
        gameName,
        status: "memorizing",
        rules,
        items: items.map((code) => engine.toView(code)),
        memorizeDeadline: addSeconds(startedAt, memorizeLimitSec),
    };
};

const startRecall: GameSessionService["startRecall"] = async (userId, sessionId) => {
    const session = await findOwnSession(userId, sessionId);
    const engine = getGameEngine(session.gameName);
    // Gọi lại khi đã ở phase nhớ lại (ví dụ mạng lỗi): trả lại đúng phase hiện tại
    if (session.status === "recalling") {
        return toRecallView(session, engine);
    }
    if (session.status !== "memorizing") {
        throw conflict(`Game session is already ${session.status}`);
    }

    const now = new Date();
    const memorizeDeadline = addSeconds(session.startedAt, session.rules.memorizeLimitSec);
    if (now > addSeconds(memorizeDeadline, PHASE_GRACE_SEC)) {
        await expireSession(session._id, "memorizing");
        throw conflict("Memorize time is over, this game session has expired");
    }

    const updated = await GameSession.findOneAndUpdate(
        { _id: session._id, status: "memorizing" },
        { $set: { status: "recalling", recallStartedAt: now } },
        { returnDocument: "after" },
    )
        .select("+items")
        .lean<GameSessionRecord>()
        .exec();
    // Không cập nhật được nghĩa là một yêu cầu khác vừa chuyển phase trước; đọc lại trạng thái mới nhất
    const current = updated ?? (await findOwnSession(userId, sessionId));
    if (current.status !== "recalling") {
        throw conflict(`Game session is already ${current.status}`);
    }
    return toRecallView(current, engine);
};

const submitRound: GameSessionService["submitRound"] = async (userId, sessionId, body) => {
    const session = await findOwnSession(userId, sessionId);
    // Nộp lại một ván đã chấm: trả lại kết quả cũ, không cộng thưởng lần nữa
    if (session.status === "completed") {
        return toCompletedView(session);
    }
    if (session.status === "memorizing") {
        throw conflict("Recall phase has not started");
    }
    if (session.status !== "recalling" || !session.recallStartedAt) {
        throw conflict(`Game session is already ${session.status}`);
    }

    const completedAt = new Date();
    const recallDeadline = addSeconds(session.recallStartedAt, session.rules.recallLimitSec);
    if (completedAt > addSeconds(recallDeadline, PHASE_GRACE_SEC)) {
        await expireSession(session._id, "recalling");
        throw conflict("Recall time is over, this game session has expired");
    }

    const answers = parseAnswers(
        getGameEngine(session.gameName),
        session.items,
        parseBody(body, SUBMIT_ROUND_FIELDS).answers,
    );
    const { gameName, recallStartedAt } = session;

    try {
        // Ghi kết quả ván, tiến độ game và tiến độ tài khoản trong cùng một transaction:
        // hoặc cả ba cùng được ghi, hoặc không có gì thay đổi.
        await mongoose.connection.transaction(async (dbSession) => {
            const gameProgress = await UserGameProgress.findOne({ userId, gameName })
                .session(dbSession)
                .lean<GameProgress>()
                .exec();
            const user = await User.findById(userId)
                .select("progress")
                .session(dbSession)
                .lean<{ progress?: UserProgress }>()
                .exec();
            if (!user) {
                throw new ApiError(StatusCodes.NOT_FOUND, "Player account was not found");
            }

            const settlement = settleRound(
                { gameName, rules: session.rules, items: session.items, answers, startedAt: session.startedAt, recallStartedAt, completedAt },
                {
                    gameProgress: gameProgress ?? createInitialGameProgress(),
                    userProgress: user.progress ?? createInitialUserProgress(),
                },
            );

            const completed = await GameSession.updateOne(
                { _id: session._id, status: "recalling" },
                {
                    $set: {
                        status: "completed",
                        answers,
                        completedAt,
                        memorizeSec: settlement.memorizeSec,
                        recallSec: settlement.recallSec,
                        correctItems: settlement.graded.correctItems,
                        accuracy: settlement.graded.accuracy,
                        result: settlement.graded.result,
                        rewards: settlement.rewards,
                    },
                    $unset: { expiresAt: 1 },
                },
                { session: dbSession },
            ).exec();
            if (completed.modifiedCount === 0) {
                throw new RoundAlreadySettledError();
            }

            await UserGameProgress.updateOne(
                { userId, gameName },
                {
                    $set: {
                        unlockedLevel: settlement.gameProgress.unlockedLevel,
                        stats: settlement.gameProgress.stats,
                        records: settlement.gameProgress.records,
                    },
                },
                { upsert: true, session: dbSession },
            ).exec();
            await User.updateOne(
                { _id: userId },
                { $set: { progress: settlement.userProgress } },
                { session: dbSession },
            ).exec();
        });
    } catch (error) {
        if (!(error instanceof RoundAlreadySettledError)) {
            throw error;
        }
    }

    return toCompletedView(await findOwnSession(userId, sessionId));
};

export const gameSessionService: GameSessionService = { startRound, startRecall, submitRound };
