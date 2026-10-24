import type { ConfiguredGameName } from "../config/games.js";
import type { UserProgress } from "../models/user.js";
import type { GameProgress, GameStats } from "../models/userGameProgress.js";
import {
    getUnlockedLevelAfterRound,
    gradeRound,
    type GradedRound,
    type RoundRules,
} from "./gameRules.service.js";
import {
    applyRoundToRecords,
    calculateRoundExp,
    createEmptyRecords,
    getUserLevel,
    type ExpReward,
    type RecordKey,
} from "./progression.service.js";
import { createEmptyStreak, recordPlayDay } from "./streak.service.js";

// Luật đã chốt của ván, lưu trong game_sessions (gameName lưu ở trường riêng)
export type StoredRoundRules = Omit<RoundRules, "gameName">;

export interface ItemResult {
    expected: string;
    answer: string | null;
    correct: boolean;
}

export interface RoundRewards {
    exp: ExpReward;
    newRecords: RecordKey[];
    unlockedLevel: { before: number; after: number };
    userLevel: { before: number; after: number };
    streak: { currentStreak: number; longestStreak: number };
}

export interface SettleRoundInput {
    gameName: ConfiguredGameName;
    rules: StoredRoundRules;
    items: readonly string[];
    // Đã được kiểm tra bằng parseAnswers: đúng số vị trí, null là bỏ trống
    answers: readonly (string | null)[];
    startedAt: Date;
    recallStartedAt: Date;
    completedAt: Date;
}

export interface CurrentProgress {
    gameProgress: GameProgress;
    userProgress: UserProgress;
}

export interface RoundSettlement {
    graded: GradedRound;
    perItem: ItemResult[];
    memorizeSec: number;
    recallSec: number;
    rewards: RoundRewards;
    // Tiến độ mới để ghi đè vào DB
    gameProgress: GameProgress;
    userProgress: UserProgress;
}

export const createInitialGameProgress = (): GameProgress => ({
    unlockedLevel: 1,
    stats: {
        played: 0,
        perfect: 0,
        pass: 0,
        fail: 0,
        totalItems: 0,
        totalCorrect: 0,
        totalMemorizeSec: 0,
        totalRecallSec: 0,
        lastPlayedAt: null,
    },
    records: createEmptyRecords(),
});

export const createInitialUserProgress = (): UserProgress => ({
    exp: 0,
    ...createEmptyStreak(),
    totalGames: 0,
    totalPlayTimeSec: 0,
});

const elapsedSec = (from: Date, to: Date, limitSec: number): number =>
    Math.min(limitSec, Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000)));

// Thời gian thực của từng phase, đo bằng mốc thời gian của server và không vượt quá giới hạn của ván
export const measureRoundTime = (
    rules: Pick<StoredRoundRules, "memorizeLimitSec" | "recallLimitSec">,
    startedAt: Date,
    recallStartedAt: Date,
    completedAt: Date,
): { memorizeSec: number; recallSec: number } => ({
    memorizeSec: elapsedSec(startedAt, recallStartedAt, rules.memorizeLimitSec),
    recallSec: elapsedSec(recallStartedAt, completedAt, rules.recallLimitSec),
});

// Chấm theo vị trí: item ở vị trí i chỉ đúng khi câu trả lời ở vị trí i trùng khớp
export const compareAnswers = (
    items: readonly string[],
    answers: readonly (string | null)[],
): ItemResult[] =>
    items.map((expected, index) => {
        const answer = answers[index] ?? null;
        return { expected, answer, correct: answer === expected };
    });

// Tính toàn bộ kết quả của một ván đã nộp cùng tiến độ mới. Hàm thuần: việc đọc và ghi DB do service đảm nhận.
export const settleRound = (input: SettleRoundInput, current: CurrentProgress): RoundSettlement => {
    const { rules } = input;
    const { gameProgress, userProgress } = current;

    const perItem = compareAnswers(input.items, input.answers);
    const graded = gradeRound(rules, perItem.filter((item) => item.correct).length);
    const { memorizeSec, recallSec } = measureRoundTime(
        rules,
        input.startedAt,
        input.recallStartedAt,
        input.completedAt,
    );

    const { records, newRecords } = applyRoundToRecords(gameProgress.records, {
        mode: rules.mode,
        gameLevel: rules.gameLevel,
        result: graded.result,
        memorizeSec,
    });
    const unlockedLevel = getUnlockedLevelAfterRound(
        { gameName: input.gameName, mode: rules.mode, gameLevel: rules.gameLevel },
        graded.result,
        gameProgress.unlockedLevel,
    );
    const { streak, isFirstGameOfDay } = recordPlayDay(userProgress, input.completedAt);
    const exp = calculateRoundExp(graded, { isFirstGameOfDay, hasNewRecord: newRecords.length > 0 });

    const stats: GameStats = {
        ...gameProgress.stats,
        played: gameProgress.stats.played + 1,
        totalItems: gameProgress.stats.totalItems + graded.totalItems,
        totalCorrect: gameProgress.stats.totalCorrect + graded.correctItems,
        totalMemorizeSec: gameProgress.stats.totalMemorizeSec + memorizeSec,
        totalRecallSec: gameProgress.stats.totalRecallSec + recallSec,
        lastPlayedAt: input.completedAt,
    };
    stats[graded.result] += 1;

    const nextUserProgress: UserProgress = {
        exp: userProgress.exp + exp.total,
        currentStreak: streak.currentStreak,
        longestStreak: streak.longestStreak,
        lastPlayedDate: streak.lastPlayedDate,
        totalGames: userProgress.totalGames + 1,
        totalPlayTimeSec: userProgress.totalPlayTimeSec + memorizeSec + recallSec,
    };

    return {
        graded,
        perItem,
        memorizeSec,
        recallSec,
        rewards: {
            exp,
            newRecords,
            unlockedLevel: { before: gameProgress.unlockedLevel, after: unlockedLevel },
            userLevel: {
                before: getUserLevel(userProgress.exp).level,
                after: getUserLevel(nextUserProgress.exp).level,
            },
            streak: { currentStreak: streak.currentStreak, longestStreak: streak.longestStreak },
        },
        gameProgress: { unlockedLevel, stats, records },
        userProgress: nextUserProgress,
    };
};
