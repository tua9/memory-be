import { StatusCodes } from "http-status-codes";
import GameSession, {
    ALLOWED_GAME_NAMES,
    type GameName,
    type GameSessionDocument,
} from "../models/gameSession.js";
import ApiError from "../utils/ApiError.js";

export interface CreateGameSessionInput {
    userId: string;
    gameName: GameName;
    time: number;
    score?: number;
}

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
    // Lưu lượt chơi mới vào DB
    async createSession(rawInput: unknown): Promise<GameSessionDocument> {
        const input = validateGameSessionInput(rawInput);

        const newSession = await GameSession.create({
            userId: input.userId,
            gameName: input.gameName,
            time: input.time,
            score: input.score,
            date: new Date(),
        });

        return newSession;
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
