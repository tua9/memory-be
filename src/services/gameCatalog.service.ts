import { CONFIGURED_GAME_NAMES, type ConfiguredGameName, type GameResult } from "../config/games.js";
import UserGameProgress, { type GameProgress } from "../models/userGameProgress.js";
import { getGameConfig, getMaxLevel } from "./gameRules.service.js";

export interface GameLevelView {
    level: number;
    itemCount: number;
}

// Tiến độ của người chơi trong một game; null với khách
export interface PlayerGameView {
    unlockedLevel: number;
    bestLevel: number | null;
    played: number;
}

export interface GameCatalogItem {
    gameName: ConfiguredGameName;
    maxLevel: number;
    levels: GameLevelView[];
    // null nếu game không có chế độ tự chọn số lượng
    customItems: { min: number; max: number } | null;
    memorizeSecOptions: number[];
    defaultMemorizeSec: number;
    recallSec: number;
    passAccuracy: number;
    unlockOn: Exclude<GameResult, "fail">;
    player: PlayerGameView | null;
}

export type StoredGameProgress = Pick<GameProgress, "unlockedLevel" | "records" | "stats">;

export interface GameCatalogService {
    // userId null: khách, không có tiến độ
    listGames(userId: string | null): Promise<GameCatalogItem[]>;
}

const toPlayerView = (gameName: ConfiguredGameName, progress: StoredGameProgress | undefined): PlayerGameView => ({
    // Config có thể bị giảm số level sau này, nên không trả level đã mở vượt quá level cao nhất
    unlockedLevel: Math.min(progress?.unlockedLevel ?? 1, getMaxLevel(gameName)),
    bestLevel: progress?.records.bestLevel ?? null,
    played: progress?.stats.played ?? 0,
});

// Luật chơi lấy từ config/games.ts để frontend không phải tự định nghĩa số thẻ, thời gian hay level
export const buildGameCatalog = (
    progressByGame: Partial<Record<ConfiguredGameName, StoredGameProgress>> | null,
): GameCatalogItem[] =>
    CONFIGURED_GAME_NAMES.map((gameName) => {
        const config = getGameConfig(gameName);
        return {
            gameName,
            maxLevel: getMaxLevel(gameName),
            levels: config.itemsPerLevel.map((itemCount, index) => ({ level: index + 1, itemCount })),
            customItems: config.customItems ? { ...config.customItems } : null,
            memorizeSecOptions: [...config.memorizeSecOptions],
            defaultMemorizeSec: config.defaultMemorizeSec,
            recallSec: config.recallSec,
            passAccuracy: config.passAccuracy,
            unlockOn: config.unlockOn,
            player: progressByGame ? toPlayerView(gameName, progressByGame[gameName]) : null,
        };
    });

const listGames: GameCatalogService["listGames"] = async (userId) => {
    if (!userId) {
        return buildGameCatalog(null);
    }
    const progress = await UserGameProgress.find({ userId })
        .select("gameName unlockedLevel records stats")
        .lean<(StoredGameProgress & { gameName: ConfiguredGameName })[]>()
        .exec();
    return buildGameCatalog(Object.fromEntries(progress.map((item) => [item.gameName, item])));
};

export const gameCatalogService: GameCatalogService = { listGames };
