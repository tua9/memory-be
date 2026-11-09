import { StatusCodes } from "http-status-codes";
import { mongo, type Types } from "mongoose";
import { DAILY_CHALLENGE_GAMES, DAILY_LEADERBOARD_SIZE } from "../config/dailyChallenge.js";
import { PHASE_GRACE_SEC, UNFINISHED_ROUND_TTL_SEC, type ConfiguredGameName } from "../config/games.js";
import { PROGRESS_TIME_ZONE } from "../config/progression.js";
import { getGameEngine } from "../games/index.js";
import GameSession, { type GameSessionStatus } from "../models/gameSession.js";
import User from "../models/user.js";
import ApiError from "../utils/ApiError.js";
import { addDaysToDateKey, startOfDateKey, toDateKey } from "../utils/date.js";
import { createSeededRandom } from "../utils/random.js";
import { getGameConfig } from "./gameRules.service.js";
import { toRoundView, type GameSessionRecord, type StartedRoundView } from "./gameSession.service.js";
import type { StoredRoundRules } from "./roundSettlement.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DailyChallenge {
    date: string;               // "YYYY-MM-DD" theo PROGRESS_TIME_ZONE
    gameName: ConfiguredGameName;
    totalItems: number;
    memorizeLimitSec: number;
    recallLimitSec: number;
    passAccuracy: number;
    poolLevel: number | null;
}

export interface RankableRound {
    userId: string;
    correctItems: number;
    totalItems: number;
    accuracy: number;
    memorizeSec: number;
    recallSec: number;
    completedAt: Date;
}

export interface LeaderboardEntry {
    rank: number;
    username: string;
    correctItems: number;
    totalItems: number;
    accuracy: number;
    memorizeSec: number;
    recallSec: number;
    durationSec: number;
    isMe: boolean;
}

// not-played: chưa dùng lượt · playing: đang chơi, còn trong hạn · completed: đã có kết quả · missed: bỏ dở, hết hạn
export type MyChallengeStatus = "not-played" | "playing" | "completed" | "missed";

export interface DailyChallengeView {
    challenge: Omit<DailyChallenge, "poolLevel"> & { players: number; endsAt: Date };
    leaderboard: LeaderboardEntry[];
    // null với khách
    me: { status: MyChallengeStatus; sessionId: string | null; entry: LeaderboardEntry | null } | null;
}

export interface DailyChallengeService {
    getChallenge(userId: string | null, now?: Date): Promise<DailyChallengeView>;
    startChallenge(userId: string, now?: Date): Promise<StartedRoundView>;
}

const addSeconds = (date: Date, seconds: number): Date => new Date(date.getTime() + seconds * 1000);

// Thử thách của ngày chứa thời điểm now: game luân phiên theo số ngày, luật lấy từ config
export const dailyChallengeFor = (now: Date): DailyChallenge => {
    const date = toDateKey(now, PROGRESS_TIME_ZONE);
    const dayNumber = Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
    const game = DAILY_CHALLENGE_GAMES[dayNumber % DAILY_CHALLENGE_GAMES.length];
    const config = getGameConfig(game.gameName);
    return {
        date,
        gameName: game.gameName,
        totalItems: game.itemCount,
        memorizeLimitSec: game.memorizeSec,
        recallLimitSec: config.recallSec,
        passAccuracy: config.passAccuracy,
        poolLevel: game.poolLevel,
    };
};

// Cùng một ngày luôn ra cùng một đề, cho mọi người chơi
export const dailyChallengeItems = (challenge: DailyChallenge): string[] =>
    getGameEngine(challenge.gameName).generateItems(
        challenge.totalItems,
        challenge.poolLevel,
        createSeededRandom(`memio-daily-${challenge.date}`),
    );

// Xếp hạng: đúng nhiều hơn đứng trên; bằng nhau thì tổng thời gian ngắn hơn; vẫn bằng thì ai nộp trước
export const rankRounds = <T extends RankableRound>(rounds: readonly T[]): (T & { rank: number })[] =>
    [...rounds]
        .sort(
            (a, b) =>
                b.correctItems - a.correctItems ||
                a.memorizeSec + a.recallSec - (b.memorizeSec + b.recallSec) ||
                a.completedAt.getTime() - b.completedAt.getTime(),
        )
        .map((round, index) => ({ ...round, rank: index + 1 }));

// Ván thử thách của người chơi đang ở trạng thái nào; ván bỏ dở quá hạn vẫn tính là đã dùng lượt
export const myChallengeStatus = (
    session: Pick<GameSessionRecord, "status" | "startedAt" | "recallStartedAt" | "rules"> | null,
    now: Date,
): MyChallengeStatus => {
    if (!session) return "not-played";
    if (session.status === "completed") return "completed";
    const memorizeEnd = addSeconds(session.startedAt, session.rules.memorizeLimitSec + PHASE_GRACE_SEC);
    if (session.status === "memorizing" && now <= memorizeEnd) return "playing";
    if (session.status === "recalling" && session.recallStartedAt) {
        const recallEnd = addSeconds(session.recallStartedAt, session.rules.recallLimitSec + PHASE_GRACE_SEC);
        if (now <= recallEnd) return "playing";
    }
    return "missed";
};

const alreadyPlayed = () =>
    new ApiError(StatusCodes.CONFLICT, "You have already played today's challenge", undefined, "DAILY_CHALLENGE_PLAYED");

type CompletedChallengeRound = {
    userId: Types.ObjectId;
    correctItems: number;
    accuracy: number;
    memorizeSec: number;
    recallSec: number;
    completedAt: Date;
    rules: { totalItems: number };
};

const getChallenge: DailyChallengeService["getChallenge"] = async (userId, now = new Date()) => {
    const challenge = dailyChallengeFor(now);
    const rounds = await GameSession.find({
        challengeDate: challenge.date,
        status: "completed",
        userId: { $ne: null },
    })
        .select("userId correctItems accuracy memorizeSec recallSec completedAt rules.totalItems")
        .lean<CompletedChallengeRound[]>()
        .exec();

    const ranked = rankRounds(
        rounds.map((round) => ({
            userId: round.userId.toString(),
            correctItems: round.correctItems,
            totalItems: round.rules.totalItems,
            accuracy: round.accuracy,
            memorizeSec: round.memorizeSec,
            recallSec: round.recallSec,
            completedAt: round.completedAt,
        })),
    );

    const mine = userId ? ranked.find((round) => round.userId === userId) : undefined;
    const shown = ranked.slice(0, DAILY_LEADERBOARD_SIZE);
    const users = await User.find({ _id: { $in: [...shown, ...(mine ? [mine] : [])].map((round) => round.userId) } })
        .select("username")
        .lean<{ _id: Types.ObjectId; username: string }[]>()
        .exec();
    const usernames = new Map(users.map((user) => [user._id.toString(), user.username]));

    const toEntry = (round: (typeof ranked)[number]): LeaderboardEntry => ({
        rank: round.rank,
        username: usernames.get(round.userId) ?? "Người chơi",
        correctItems: round.correctItems,
        totalItems: round.totalItems,
        accuracy: round.accuracy,
        memorizeSec: round.memorizeSec,
        recallSec: round.recallSec,
        durationSec: round.memorizeSec + round.recallSec,
        isMe: round.userId === userId,
    });

    let me: DailyChallengeView["me"] = null;
    if (userId) {
        const session = await GameSession.findOne({ userId, challengeDate: challenge.date })
            .select("status startedAt recallStartedAt rules")
            .lean<Pick<GameSessionRecord, "_id" | "status" | "startedAt" | "recallStartedAt" | "rules">>()
            .exec();
        me = {
            status: myChallengeStatus(session, now),
            sessionId: session?._id.toString() ?? null,
            entry: mine ? toEntry(mine) : null,
        };
    }

    const { poolLevel: _poolLevel, ...info } = challenge;
    return {
        challenge: {
            ...info,
            players: ranked.length,
            endsAt: startOfDateKey(addDaysToDateKey(challenge.date, 1), PROGRESS_TIME_ZONE),
        },
        leaderboard: shown.map(toEntry),
        me,
    };
};

const isDuplicateKey = (error: unknown) => error instanceof mongo.MongoServerError && error.code === 11000;

const startChallenge: DailyChallengeService["startChallenge"] = async (userId, now = new Date()) => {
    const challenge = dailyChallengeFor(now);
    const engine = getGameEngine(challenge.gameName);

    const existing = await GameSession.findOne({ userId, challengeDate: challenge.date })
        .select("+items")
        .lean<GameSessionRecord>()
        .exec();
    if (existing) {
        // Mạng lỗi lúc vừa bắt đầu: còn trong hạn ghi nhớ thì trả lại đúng ván đó, không tạo lượt mới
        if (myChallengeStatus(existing, now) === "playing" && existing.status === "memorizing") {
            return {
                ...toRoundView(existing),
                items: existing.items.map((code) => engine.toView(code)),
                memorizeDeadline: addSeconds(existing.startedAt, existing.rules.memorizeLimitSec),
            };
        }
        throw alreadyPlayed();
    }

    const rules: StoredRoundRules = {
        mode: "daily",
        gameLevel: null,
        totalItems: challenge.totalItems,
        memorizeLimitSec: challenge.memorizeLimitSec,
        recallLimitSec: challenge.recallLimitSec,
        passAccuracy: challenge.passAccuracy,
    };
    const items = dailyChallengeItems(challenge);

    try {
        const session = await GameSession.create({
            userId,
            guestId: null,
            gameName: challenge.gameName,
            status: "memorizing" satisfies GameSessionStatus,
            rules,
            items,
            startedAt: now,
            expiresAt: addSeconds(now, UNFINISHED_ROUND_TTL_SEC),
            challengeDate: challenge.date,
        });
        return {
            sessionId: session._id.toString(),
            gameName: challenge.gameName,
            status: "memorizing",
            rules,
            items: items.map((code) => engine.toView(code)),
            memorizeDeadline: addSeconds(now, challenge.memorizeLimitSec),
        };
    } catch (error) {
        // Hai yêu cầu bắt đầu gửi cùng lúc: unique index chỉ cho một ván được tạo
        if (isDuplicateKey(error)) throw alreadyPlayed();
        throw error;
    }
};

export const dailyChallengeService: DailyChallengeService = { getChallenge, startChallenge };
