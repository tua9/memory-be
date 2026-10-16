import { StatusCodes } from "http-status-codes";
import GameSession, {
    ALLOWED_GAME_NAMES,
    type GameName,
    type GameSessionDocument,
} from "../models/gameSession.js";
import User from "../models/user.js";
import ApiError from "../utils/ApiError.js";

export interface CreateGameSessionInput {
    userId: string;
    gameName: GameName;
    time: number;
    score?: number;
}

export interface UserProgress {
    exp: number;
    streaks: number;
    lastActiveDate: Date | null;
}

export interface GameSessionRepository {
    userExists(userId: string): Promise<boolean>;
    createSession(input: CreateGameSessionInput): Promise<GameSessionDocument>;
    getSessionsByUserId(userId: string): Promise<Pick<GameSessionDocument, "score" | "date">[]>;
    updateUserProgress(userId: string, progress: UserProgress): Promise<boolean>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const calculateUserProgress = (
    sessions: Pick<GameSessionDocument, "score" | "date">[],
): UserProgress => {
    if (sessions.length === 0) {
        return { exp: 0, streaks: 0, lastActiveDate: null };
    }

    const activeDays = [...new Set(sessions.map(({ date }) =>
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    ))].sort((first, second) => first - second);

    let streaks = 0;
    for (let index = 0; index < activeDays.length; index += 1) {
        streaks = index > 0 && activeDays[index] - activeDays[index - 1] === DAY_MS
            ? streaks + 1
            : 1;
    }

    const latestSessionDate = sessions.reduce(
        (latest, { date }) => date > latest ? date : latest,
        sessions[0].date,
    );

    return {
        exp: sessions.reduce((total, { score }) => total + score, 0),
        streaks,
        lastActiveDate: latestSessionDate,
    };
};

const defaultRepository: GameSessionRepository = {
    userExists: async (userId) => Boolean(await User.exists({ _id: userId })),
    createSession: async (input) => GameSession.create({ ...input, date: new Date() }),
    getSessionsByUserId: async (userId) => GameSession.find({ userId }).select("score date").exec(),
    updateUserProgress: async (userId, progress) => {
        const result = await User.updateOne({ _id: userId }, { $set: progress }).exec();
        return result.matchedCount > 0;
    },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

// Hàm validate đầu vào
export const validateGameSessionInput = (body: unknown): CreateGameSessionInput => {
    if (!isRecord(body)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "A JSON object is required");
    }

    const { userId, gameName, time, score } = body;

    // 1. Kiểm tra userId
    if (typeof userId !== "string" || !userId.trim()) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "userId is required and must be a non-empty string");
    }

    // 2. Kiểm tra gameName (phải nằm trong danh sách enum: card, image, number)
    if (typeof gameName !== "string" || !gameName.trim()) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "gameName is required");
    }

    const normalizedGameName = gameName.trim().toLowerCase();
    if (!ALLOWED_GAME_NAMES.includes(normalizedGameName as GameName)) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            `gameName must be one of: ${ALLOWED_GAME_NAMES.join(", ")}`,
        );
    }

    // 3. Kiểm tra time
    if (typeof time !== "number" || !Number.isInteger(time) || time < 0) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "time is required and must be a non-negative integer");
    }

    // 4. Kiểm tra score
    let parsedScore = 0;
    if (score !== undefined && score !== null) {
        if (typeof score !== "number" || !Number.isInteger(score) || score < 0) {
            throw new ApiError(StatusCodes.BAD_REQUEST, "score must be a non-negative integer");
        }
        parsedScore = score;
    }

    return {
        userId: userId.trim(),
        gameName: normalizedGameName as GameName,
        time,
        score: parsedScore,
    };
};

export class GameSessionService {
    constructor(private readonly repository: GameSessionRepository = defaultRepository) {}

    // Lưu lượt chơi mới vào DB
    async createSession(rawInput: unknown): Promise<GameSessionDocument> {
        const input = validateGameSessionInput(rawInput);
        if (!await this.repository.userExists(input.userId)) {
            throw new ApiError(StatusCodes.NOT_FOUND, "Session owner was not found");
        }

        const newSession = await this.repository.createSession(input);
        await this.syncUserProgress(input.userId);
        return newSession;
    }

    async syncUserProgress(userId: string): Promise<UserProgress> {
        if (!userId || !userId.trim()) {
            throw new ApiError(StatusCodes.BAD_REQUEST, "userId is required");
        }
        if (!await this.repository.userExists(userId.trim())) {
            throw new ApiError(StatusCodes.NOT_FOUND, "Session owner was not found");
        }

        const sessions = await this.repository.getSessionsByUserId(userId.trim());
        const progress = calculateUserProgress(sessions);
        if (!await this.repository.updateUserProgress(userId.trim(), progress)) {
            throw new ApiError(StatusCodes.NOT_FOUND, "Session owner was not found");
        }
        return progress;
    }

    // Lấy lịch sử chơi theo userId
    async getHistoryByUserId(userId: string): Promise<GameSessionDocument[]> {
        if (!userId || !userId.trim()) {
            throw new ApiError(StatusCodes.BAD_REQUEST, "userId is required");
        }

        return GameSession.find({ userId: userId.trim() })
            .sort({ date: -1 })
            .exec();
    }
}

export const gameSessionService = new GameSessionService();
