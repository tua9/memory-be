import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import type { ConfiguredGameName, GameMode, GameResult } from "../config/games.js";
import GameSession from "../models/gameSession.js";
import ApiError from "../utils/ApiError.js";
import { parseGameName } from "./gameRules.service.js";
import {
    findOwnSession,
    requireCompletedResult,
    toCompletedView,
    toRoundView,
    type CompletedRoundView,
    type GameSessionRecord,
    type RoundView,
} from "./gameSession.service.js";
import type { RecordKey } from "./progression.service.js";

export interface HistoryItemView {
    sessionId: string;
    gameName: ConfiguredGameName;
    mode: GameMode;
    gameLevel: number | null;
    totalItems: number;
    correctItems: number;
    accuracy: number;
    result: GameResult;
    memorizeSec: number;
    recallSec: number;
    expEarned: number;
    newRecords: RecordKey[];
    completedAt: Date;
}

export interface HistoryPage {
    items: HistoryItemView[];
    // null khi đã hết dữ liệu
    nextCursor: string | null;
}

// Ván chưa hoàn thành chỉ trả trạng thái và luật, không trả đáp án để không lộ bài khi đang nhớ lại
export type SessionDetailView = CompletedRoundView | (RoundView & { startedAt: Date });

export interface GameHistoryService {
    listHistory(userId: string, query: unknown): Promise<HistoryPage>;
    getSessionDetail(userId: string, sessionId: string): Promise<SessionDetailView>;
}

export interface HistoryCursor {
    completedAt: Date;
    sessionId: Types.ObjectId;
}

export interface HistoryQuery {
    gameName?: ConfiguredGameName;
    from?: Date;
    // Không bao gồm mốc này
    to?: Date;
    limit: number;
    cursor?: HistoryCursor;
}

export const DEFAULT_HISTORY_LIMIT = 20;
export const MAX_HISTORY_LIMIT = 50;

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const parseDate = (value: unknown, name: string): Date | undefined => {
    if (value === undefined) {
        return undefined;
    }
    const date = typeof value === "string" ? new Date(value) : new Date(Number.NaN);
    if (Number.isNaN(date.getTime())) {
        throw new ApiError(StatusCodes.BAD_REQUEST, `${name} must be an ISO date`);
    }
    return date;
};

// Con trỏ sang trang tiếp theo = completedAt và _id của ván cuối trang, mã hoá base64url.
// Dùng cả _id để không bỏ sót hay lặp ván khi nhiều ván có cùng completedAt.
export const encodeHistoryCursor = (cursor: HistoryCursor): string =>
    Buffer.from(`${cursor.completedAt.toISOString()}|${cursor.sessionId.toString()}`).toString("base64url");

const decodeHistoryCursor = (value: unknown): HistoryCursor | undefined => {
    if (value === undefined) {
        return undefined;
    }
    const invalid = new ApiError(StatusCodes.BAD_REQUEST, "cursor is invalid");
    if (typeof value !== "string") {
        throw invalid;
    }
    const [isoDate = "", sessionId = ""] = Buffer.from(value, "base64url").toString("utf8").split("|");
    const completedAt = new Date(isoDate);
    if (Number.isNaN(completedAt.getTime()) || !OBJECT_ID_PATTERN.test(sessionId)) {
        throw invalid;
    }
    return { completedAt, sessionId: new Types.ObjectId(sessionId) };
};

export const parseHistoryQuery = (query: unknown): HistoryQuery => {
    const { game, from, to, limit, cursor } = isRecord(query) ? query : {};

    let parsedLimit = DEFAULT_HISTORY_LIMIT;
    if (limit !== undefined) {
        parsedLimit = typeof limit === "string" && /^\d+$/.test(limit) ? Number(limit) : Number.NaN;
        if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_HISTORY_LIMIT) {
            throw new ApiError(StatusCodes.BAD_REQUEST, `limit must be an integer from 1 to ${MAX_HISTORY_LIMIT}`);
        }
    }

    const parsed: HistoryQuery = {
        gameName: game === undefined ? undefined : parseGameName(game),
        from: parseDate(from, "from"),
        to: parseDate(to, "to"),
        limit: parsedLimit,
        cursor: decodeHistoryCursor(cursor),
    };
    if (parsed.from && parsed.to && parsed.from >= parsed.to) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "from must be earlier than to");
    }
    return parsed;
};

const toHistoryItem = (session: GameSessionRecord): HistoryItemView => {
    const completed = requireCompletedResult(session);
    return {
        sessionId: session._id.toString(),
        gameName: session.gameName,
        mode: session.rules.mode,
        gameLevel: session.rules.gameLevel,
        totalItems: session.rules.totalItems,
        correctItems: completed.correctItems,
        accuracy: completed.accuracy,
        result: completed.result,
        memorizeSec: completed.memorizeSec,
        recallSec: completed.recallSec,
        expEarned: completed.rewards.exp.total,
        newRecords: completed.rewards.newRecords,
        completedAt: completed.completedAt,
    };
};

// Lịch sử các ván đã hoàn thành của chính người chơi, mới nhất trước
const listHistory: GameHistoryService["listHistory"] = async (userId, rawQuery) => {
    const { gameName, from, to, limit, cursor } = parseHistoryQuery(rawQuery);

    const completedAt = from || to ? { ...(from && { $gte: from }), ...(to && { $lt: to }) } : undefined;
    const sessions = await GameSession.find({
        userId,
        status: "completed",
        ...(gameName && { gameName }),
        ...(completedAt && { completedAt }),
        ...(cursor && {
            $or: [
                { completedAt: { $lt: cursor.completedAt } },
                { completedAt: cursor.completedAt, _id: { $lt: cursor.sessionId } },
            ],
        }),
    })
        .select("-answers")
        .sort({ completedAt: -1, _id: -1 })
        // Lấy dư một ván để biết còn trang tiếp theo hay không
        .limit(limit + 1)
        .lean<GameSessionRecord[]>()
        .exec();

    const page = sessions.slice(0, limit);
    const last = page.at(-1);
    return {
        items: page.map(toHistoryItem),
        nextCursor: sessions.length > limit && last?.completedAt
            ? encodeHistoryCursor({ completedAt: last.completedAt, sessionId: last._id })
            : null,
    };
};

const getSessionDetail: GameHistoryService["getSessionDetail"] = async (userId, sessionId) => {
    const session = await findOwnSession(userId, sessionId);
    if (session.status === "completed") {
        return toCompletedView(session);
    }
    return { ...toRoundView(session), startedAt: session.startedAt };
};

export const gameHistoryService: GameHistoryService = { listHistory, getSessionDetail };
