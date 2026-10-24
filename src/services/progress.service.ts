import { StatusCodes } from "http-status-codes";
import GameSession from "../models/gameSession.js";
import ApiError from "../utils/ApiError.js";
import { parseGameName } from "./gameRules.service.js";
import { requireCompletedResult, type GameSessionRecord } from "./gameSession.service.js";
import {
    TIMELINE_PERIODS,
    buildTimeline,
    getTimelineRanges,
    type Timeline,
    type TimelineGameFilter,
    type TimelinePeriod,
    type TimelineSession,
} from "./timeline.service.js";

export interface ProgressService {
    getTimeline(userId: string, query: unknown, now?: Date): Promise<Timeline>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const isTimelinePeriod = (value: unknown): value is TimelinePeriod =>
    typeof value === "string" && Object.hasOwn(TIMELINE_PERIODS, value);

export const parseTimelineQuery = (query: unknown): { period: TimelinePeriod; game: TimelineGameFilter } => {
    const { period = "week", game = "all" } = isRecord(query) ? query : {};
    if (!isTimelinePeriod(period)) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            `period must be one of: ${Object.keys(TIMELINE_PERIODS).join(", ")}`,
        );
    }
    return { period, game: game === "all" ? "all" : parseGameName(game) };
};

const toTimelineSession = (session: GameSessionRecord): TimelineSession => {
    const completed = requireCompletedResult(session);
    return {
        gameName: session.gameName,
        completedAt: completed.completedAt,
        gameLevel: session.rules.gameLevel,
        totalItems: session.rules.totalItems,
        correctItems: completed.correctItems,
        result: completed.result,
        durationSec: completed.memorizeSec + completed.recallSec,
    };
};

// Thống kê cho dashboard: các kỳ hiện tại và cùng số kỳ ngay trước đó để so sánh
const getTimeline: ProgressService["getTimeline"] = async (userId, query, now = new Date()) => {
    const { period, game } = parseTimelineQuery(query);
    const ranges = getTimelineRanges(period, now);
    const sessions = await GameSession.find({
        userId,
        status: "completed",
        completedAt: { $gte: ranges.previousRange.start, $lt: ranges.range.end },
        ...(game !== "all" && { gameName: game }),
    })
        .select("-answers")
        .lean<GameSessionRecord[]>()
        .exec();

    return buildTimeline({ period, game, ranges, sessions: sessions.map(toTimelineSession) });
};

export const progressService: ProgressService = { getTimeline };
