import { CONFIGURED_GAME_NAMES, type ConfiguredGameName, type GameResult } from "../config/games.js";
import GuestProgress, { type GuestProgressData } from "../models/guestProgress.js";
import UserGameProgress, { type GameProgress } from "../models/userGameProgress.js";
import type { PlayerRef } from "../utils/request.js";
import { getGameConfig, getMaxLevel } from "./gameRules.service.js";

export interface GameLevelView {
    level: number;
    itemCount: number;
}

// Tiến độ của người chơi trong một game; khách chỉ có level đã mở (giữ tạm), không có kỷ lục
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
    // null với khách chưa chơi ván nào
    player: PlayerGameView | null;
}

export type StoredGameProgress = Pick<GameProgress, "unlockedLevel" | "records" | "stats">;

export interface GameCatalogService {
    // player null: khách chưa có cookie, không có tiến độ
    listGames(player: PlayerRef | null): Promise<GameCatalogItem[]>;
}

const toPlayerView = (gameName: ConfiguredGameName, player: PlayerGameView | undefined): PlayerGameView => ({
    // Config có thể bị giảm số level sau này, nên không trả level đã mở vượt quá level cao nhất
    unlockedLevel: Math.min(player?.unlockedLevel ?? 1, getMaxLevel(gameName)),
    bestLevel: player?.bestLevel ?? null,
    played: player?.played ?? 0,
});

export const fromStoredProgress = (progress: StoredGameProgress): PlayerGameView => ({
    unlockedLevel: progress.unlockedLevel,
    bestLevel: progress.records.bestLevel,
    played: progress.stats.played,
});

// Luật chơi lấy từ config/games.ts để frontend không phải tự định nghĩa số thẻ, thời gian hay level
export const buildGameCatalog = (
    playerByGame: Partial<Record<ConfiguredGameName, PlayerGameView>> | null,
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
            player: playerByGame ? toPlayerView(gameName, playerByGame[gameName]) : null,
        };
    });

const listGames: GameCatalogService["listGames"] = async (player) => {
    if (!player) {
        return buildGameCatalog(null);
    }
    if ("userId" in player) {
        const progress = await UserGameProgress.find({ userId: player.userId })
            .select("gameName unlockedLevel records stats")
            .lean<(StoredGameProgress & { gameName: ConfiguredGameName })[]>()
            .exec();
        return buildGameCatalog(Object.fromEntries(progress.map((item) => [item.gameName, fromStoredProgress(item)])));
    }
    const progress = await GuestProgress.find({ guestId: player.guestId })
        .select("gameName unlockedLevel played")
        .lean<Pick<GuestProgressData, "gameName" | "unlockedLevel" | "played">[]>()
        .exec();
    return buildGameCatalog(
        Object.fromEntries(
            progress.map((item) => [
                item.gameName,
                { unlockedLevel: item.unlockedLevel, bestLevel: null, played: item.played },
            ]),
        ),
    );
};

export const gameCatalogService: GameCatalogService = { listGames };
