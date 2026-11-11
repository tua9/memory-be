import { Types } from "mongoose";
import { CONFIGURED_GAME_NAMES, type ConfiguredGameName } from "../config/games.js";
import GameSession from "../models/gameSession.js";
import UserGameProgress from "../models/userGameProgress.js";
import { getMaxLevel } from "../services/gameRules.service.js";

export interface StoredCoachProgress {
    gameName: ConfiguredGameName;
    unlockedLevel: number;
    played: number;
    perfect: number;
    totalItems: number;
    totalCorrect: number;
    bestLevel: number | null;
}

type AggregatedCoachProgress = Omit<StoredCoachProgress, "unlockedLevel">;

export interface CoachGameAnalysis {
    gameName: ConfiguredGameName;
    played: number;
    accuracy: number | null;
    unlockedLevel: number;
    bestLevel: number | null;
    perfect: number;
}

export interface CoachPlanStep {
    day: number;
    focus: "practice" | "maintain" | "review";
    gameName: ConfiguredGameName;
    level: number;
    targetAccuracy: number;
    tip: string;
}

export interface CoachAnalysis {
    totalPlayed: number;
    overallAccuracy: number | null;
    skillLevel: "new" | "early" | "building" | "steady" | "advanced";
    strongestGame: ConfiguredGameName | null;
    focusGame: ConfiguredGameName | null;
    games: CoachGameAnalysis[];
    plan: CoachPlanStep[];
}

const GAME_TIPS: Record<ConfiguredGameName, string> = {
    card: "Nhóm các lá theo chất và màu, rồi đọc lại theo từng cụm nhỏ.",
    image: "Tạo một câu chuyện ngắn nối các hình theo thứ tự xuất hiện.",
    number: "Chia dãy số thành cụm 2–3 chữ số và gắn mỗi cụm với hình ảnh quen thuộc.",
    facename: "Nối một đặc điểm dễ nhớ trên gương mặt với âm thanh hoặc hình ảnh của tên.",
    word: "Liên kết các từ thành một câu chuyện có hình ảnh và hành động rõ ràng.",
};

const accuracyOf = (totalItems: number, totalCorrect: number): number | null =>
    totalItems > 0 ? totalCorrect / totalItems : null;

const skillLevelOf = (played: number, accuracy: number | null): CoachAnalysis["skillLevel"] => {
    if (played === 0) return "new";
    if (played < 3) return "early";
    if (accuracy === null || accuracy < 0.8) return "building";
    if (accuracy < 0.9) return "steady";
    return "advanced";
};

const getPlan = (
    focusGame: CoachGameAnalysis,
    strongestGame: CoachGameAnalysis | undefined,
): CoachPlanStep[] => {
    const level = focusGame.unlockedLevel;
    const targetAccuracy = focusGame.accuracy === null || focusGame.accuracy < 0.7
        ? 70
        : focusGame.accuracy < 0.85 ? 80 : 90;
    const practice = (day: number, focus: CoachPlanStep["focus"], game: CoachGameAnalysis): CoachPlanStep => ({
        day,
        focus,
        gameName: game.gameName,
        level: focus === "maintain" ? game.unlockedLevel : level,
        targetAccuracy: focus === "maintain" ? Math.max(80, targetAccuracy) : targetAccuracy,
        tip: GAME_TIPS[game.gameName],
    });
    const maintenanceGame = strongestGame?.gameName !== focusGame.gameName ? strongestGame : undefined;

    return [
        practice(1, "practice", focusGame),
        practice(3, maintenanceGame ? "maintain" : "practice", maintenanceGame ?? focusGame),
        practice(5, "review", focusGame),
    ];
};

export const buildCoachAnalysis = (
    progress: readonly StoredCoachProgress[],
): CoachAnalysis => {
    const byGame = new Map(progress.map((item) => [item.gameName, item]));
    const games = CONFIGURED_GAME_NAMES.map((gameName): CoachGameAnalysis => {
        const stored = byGame.get(gameName);
        return {
            gameName,
            played: stored?.played ?? 0,
            accuracy: accuracyOf(stored?.totalItems ?? 0, stored?.totalCorrect ?? 0),
            unlockedLevel: Math.min(stored?.unlockedLevel ?? 1, getMaxLevel(gameName)),
            bestLevel: stored?.bestLevel ?? null,
            perfect: stored?.perfect ?? 0,
        };
    });
    const totalPlayed = games.reduce((sum, game) => sum + game.played, 0);
    const totalItems = progress.reduce((sum, game) => sum + game.totalItems, 0);
    const totalCorrect = progress.reduce((sum, game) => sum + game.totalCorrect, 0);
    const overallAccuracy = accuracyOf(totalItems, totalCorrect);
    const playedGames = games.filter((game) => game.played > 0);
    const rankedGames = playedGames.some((game) => game.played >= 3)
        ? playedGames.filter((game) => game.played >= 3)
        : playedGames;
    const strongest = [...rankedGames].sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0))[0];
    const focus = [...rankedGames].sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))[0];
    const focusGame = focus ?? games[0];

    return {
        totalPlayed,
        overallAccuracy,
        skillLevel: skillLevelOf(totalPlayed, overallAccuracy),
        strongestGame: strongest?.gameName ?? null,
        focusGame: focus?.gameName ?? null,
        games,
        plan: getPlan(focusGame, strongest),
    };
};

const getCoach: CoachService["getCoach"] = async (userId) => {
    const [levelResults, unlockedProgress] = await Promise.all([
        GameSession.aggregate<AggregatedCoachProgress>([
            { $match: { userId: new Types.ObjectId(userId), status: "completed", "rules.mode": "level" } },
            {
                $group: {
                    _id: "$gameName",
                    played: { $sum: 1 },
                    perfect: { $sum: { $cond: [{ $eq: ["$result", "perfect"] }, 1, 0] } },
                    totalItems: { $sum: "$rules.totalItems" },
                    totalCorrect: { $sum: "$correctItems" },
                    bestLevel: {
                        $max: { $cond: [{ $eq: ["$result", "perfect"] }, "$rules.gameLevel", null] },
                    },
                },
            },
            { $project: { _id: 0, gameName: "$_id", played: 1, perfect: 1, totalItems: 1, totalCorrect: 1, bestLevel: 1 } },
        ]).exec(),
        UserGameProgress.find({ userId })
            .select("gameName unlockedLevel")
            .lean<{ gameName: ConfiguredGameName; unlockedLevel: number }[]>()
            .exec(),
    ]);
    const unlockedByGame = new Map(unlockedProgress.map((game) => [game.gameName, game.unlockedLevel]));
    return buildCoachAnalysis(levelResults.map((game) => ({
        ...game,
        unlockedLevel: unlockedByGame.get(game.gameName) ?? 1,
    })));
};

export interface CoachService {
    getCoach(userId: string): Promise<CoachAnalysis>;
}

export const coachService: CoachService = { getCoach };
