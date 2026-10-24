import { StatusCodes } from "http-status-codes";
import {
    CONFIGURED_GAME_NAMES,
    GAME_CONFIGS,
    GAME_MODES,
    GAME_RESULTS,
    type ConfiguredGameName,
    type GameConfig,
    type GameMode,
    type GameResult,
} from "../config/games.js";
import ApiError from "../utils/ApiError.js";

// Luật của một ván, chốt lúc bắt đầu và lưu kèm ván chơi,
// để sau này đổi config cũng không làm sai lịch sử cũ
export interface RoundRules {
    gameName: ConfiguredGameName;
    mode: GameMode;
    // null với ván tự chọn số lượng
    gameLevel: number | null;
    totalItems: number;
    memorizeLimitSec: number;
    recallLimitSec: number;
    passAccuracy: number;
}

export interface RoundSetupInput {
    mode?: unknown;
    gameLevel?: unknown;
    itemCount?: unknown;
    memorizeSec?: unknown;
}

export interface GradedRound {
    totalItems: number;
    correctItems: number;
    accuracy: number;
    result: GameResult;
}

const isInteger = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value);

const isGameMode = (value: unknown): value is GameMode =>
    typeof value === "string" && (GAME_MODES as readonly string[]).includes(value);

const isResultAtLeast = (result: GameResult, minimum: GameResult): boolean =>
    GAME_RESULTS.indexOf(result) >= GAME_RESULTS.indexOf(minimum);

export const isConfiguredGame = (value: unknown): value is ConfiguredGameName =>
    typeof value === "string" && Object.hasOwn(GAME_CONFIGS, value);

export const parseGameName = (value: unknown): ConfiguredGameName => {
    if (!isConfiguredGame(value)) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            `gameName must be one of: ${CONFIGURED_GAME_NAMES.join(", ")}`,
        );
    }
    return value;
};

export const getGameConfig = (gameName: ConfiguredGameName): GameConfig => GAME_CONFIGS[gameName];

export const getMaxLevel = (gameName: ConfiguredGameName): number =>
    getGameConfig(gameName).itemsPerLevel.length;

export const getItemCountForLevel = (gameName: ConfiguredGameName, level: number): number => {
    const count = getGameConfig(gameName).itemsPerLevel[level - 1];
    if (!isInteger(level) || count === undefined) {
        throw new RangeError(`Level ${level} does not exist for game "${gameName}"`);
    }
    return count;
};

// Kiểm tra yêu cầu bắt đầu ván và chốt luật cho ván đó.
// unlockedLevel là level cao nhất người chơi đã mở (của tài khoản hoặc của khách).
export const resolveRoundRules = (
    gameName: ConfiguredGameName,
    input: RoundSetupInput,
    unlockedLevel: number,
): RoundRules => {
    const config = getGameConfig(gameName);
    const mode = input.mode ?? "level";
    if (!isGameMode(mode)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, `mode must be one of: ${GAME_MODES.join(", ")}`);
    }

    const memorizeSec = input.memorizeSec ?? config.defaultMemorizeSec;
    if (!isInteger(memorizeSec) || !config.memorizeSecOptions.includes(memorizeSec)) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            `memorizeSec must be one of: ${config.memorizeSecOptions.join(", ")}`,
        );
    }

    const baseRules = {
        gameName,
        mode,
        memorizeLimitSec: memorizeSec,
        recallLimitSec: config.recallSec,
        passAccuracy: config.passAccuracy,
    };

    if (mode === "custom") {
        if (!config.customItems) {
            throw new ApiError(StatusCodes.BAD_REQUEST, `Custom mode is not available for game "${gameName}"`);
        }
        if (input.gameLevel !== undefined) {
            throw new ApiError(StatusCodes.BAD_REQUEST, "gameLevel is not allowed in custom mode");
        }
        const { min, max } = config.customItems;
        if (!isInteger(input.itemCount) || input.itemCount < min || input.itemCount > max) {
            throw new ApiError(StatusCodes.BAD_REQUEST, `itemCount must be an integer from ${min} to ${max}`);
        }
        return { ...baseRules, gameLevel: null, totalItems: input.itemCount };
    }

    if (input.itemCount !== undefined) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "itemCount is only allowed in custom mode");
    }
    const maxLevel = getMaxLevel(gameName);
    // Config có thể bị giảm số level sau này, nên không để level đã mở vượt quá level cao nhất
    const highestPlayableLevel = Math.min(unlockedLevel, maxLevel);
    const gameLevel = input.gameLevel ?? highestPlayableLevel;
    if (!isInteger(gameLevel) || gameLevel < 1 || gameLevel > maxLevel) {
        throw new ApiError(StatusCodes.BAD_REQUEST, `gameLevel must be an integer from 1 to ${maxLevel}`);
    }
    if (gameLevel > highestPlayableLevel) {
        throw new ApiError(StatusCodes.FORBIDDEN, `Level ${gameLevel} is locked`);
    }

    return { ...baseRules, gameLevel, totalItems: getItemCountForLevel(gameName, gameLevel) };
};

export const gradeRound = (
    rules: Pick<RoundRules, "totalItems" | "passAccuracy">,
    correctItems: number,
): GradedRound => {
    const { totalItems, passAccuracy } = rules;
    if (!isInteger(totalItems) || totalItems < 1) {
        throw new RangeError("totalItems must be a positive integer");
    }
    if (!isInteger(correctItems) || correctItems < 0 || correctItems > totalItems) {
        throw new RangeError("correctItems must be an integer from 0 to totalItems");
    }

    const accuracy = correctItems / totalItems;
    let result: GameResult = "fail";
    if (correctItems === totalItems) {
        result = "perfect";
    } else if (accuracy >= passAccuracy) {
        result = "pass";
    }
    return { totalItems, correctItems, accuracy, result };
};

// Chỉ mở level mới khi chơi đúng level cao nhất đã mở và đạt kết quả yêu cầu; ván tự chọn không mở level
export const getUnlockedLevelAfterRound = (
    rules: Pick<RoundRules, "gameName" | "mode" | "gameLevel">,
    result: GameResult,
    unlockedLevel: number,
): number => {
    if (rules.mode !== "level" || rules.gameLevel !== unlockedLevel) {
        return unlockedLevel;
    }
    if (!isResultAtLeast(result, getGameConfig(rules.gameName).unlockOn)) {
        return unlockedLevel;
    }
    return Math.min(unlockedLevel + 1, getMaxLevel(rules.gameName));
};
