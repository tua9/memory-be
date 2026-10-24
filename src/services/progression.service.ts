import type { GameMode, GameResult } from "../config/games.js";
import { EXP_RULES, USER_LEVEL_EXP_STEP } from "../config/progression.js";
import type { GradedRound } from "./gameRules.service.js";

export interface ExpBreakdown {
    // EXP theo tỷ lệ đúng, đã giảm nếu ván chưa đạt
    round: number;
    perfectBonus: number;
    firstGameOfDayBonus: number;
    newRecordBonus: number;
}

export interface ExpReward {
    total: number;
    breakdown: ExpBreakdown;
}

export interface ExpContext {
    isFirstGameOfDay: boolean;
    hasNewRecord: boolean;
}

export interface UserLevelInfo {
    level: number;
    // EXP đã tích luỹ trong cấp hiện tại
    expIntoLevel: number;
    // Tổng EXP của cấp hiện tại, đủ số này thì lên cấp tiếp theo
    expForNextLevel: number;
}

export interface GameRecords {
    // Level cao nhất đã hoàn thành hoàn hảo
    bestLevel: number | null;
    // Thời gian ghi nhớ ngắn nhất (giây) của ván hoàn hảo, theo từng level
    fastestMemorizeSecByLevel: Record<string, number>;
}

export type RecordKey = "bestLevel" | "fastestMemorize";

export interface RecordCandidate {
    mode: GameMode;
    gameLevel: number | null;
    result: GameResult;
    memorizeSec: number;
}

export const calculateRoundExp = (
    round: Pick<GradedRound, "correctItems" | "result">,
    context: ExpContext,
): ExpReward => {
    // Bằng trần EXP (totalItems × expPerItem) nhân tỷ lệ đúng, nhưng tính trên số nguyên để tránh sai số
    const proportionalExp = round.correctItems * EXP_RULES.expPerItem;
    const roundExp = round.result === "fail"
        ? proportionalExp * EXP_RULES.failMultiplier
        : proportionalExp;

    const breakdown: ExpBreakdown = {
        round: Math.max(EXP_RULES.minRoundExp, Math.round(roundExp)),
        perfectBonus: round.result === "perfect" ? EXP_RULES.perfectBonus : 0,
        firstGameOfDayBonus: context.isFirstGameOfDay ? EXP_RULES.firstGameOfDayBonus : 0,
        newRecordBonus: context.hasNewRecord ? EXP_RULES.newRecordBonus : 0,
    };
    const total = breakdown.round + breakdown.perfectBonus
        + breakdown.firstGameOfDayBonus + breakdown.newRecordBonus;

    return { total, breakdown };
};

const totalExpToReachLevel = (level: number): number =>
    (USER_LEVEL_EXP_STEP * level * (level - 1)) / 2;

// Cấp được tính từ tổng EXP mỗi lần đọc, không lưu riêng để hai con số không bao giờ lệch nhau
export const getUserLevel = (exp: number): UserLevelInfo => {
    if (!Number.isFinite(exp) || exp < 0) {
        throw new RangeError("exp must be a non-negative number");
    }

    let level = Math.floor((1 + Math.sqrt(1 + (8 * exp) / USER_LEVEL_EXP_STEP)) / 2);
    // Bù sai số dấu phẩy động khi exp nằm sát ngưỡng lên cấp
    while (totalExpToReachLevel(level + 1) <= exp) level += 1;
    while (level > 1 && totalExpToReachLevel(level) > exp) level -= 1;

    return {
        level,
        expIntoLevel: exp - totalExpToReachLevel(level),
        expForNextLevel: USER_LEVEL_EXP_STEP * level,
    };
};

export const createEmptyRecords = (): GameRecords => ({
    bestLevel: null,
    fastestMemorizeSecByLevel: {},
});

// Chỉ ván hoàn hảo chơi theo level mới được xét kỷ lục; ván tự chọn số lượng không tính
export const applyRoundToRecords = (
    records: GameRecords,
    round: RecordCandidate,
): { records: GameRecords; newRecords: RecordKey[] } => {
    if (round.mode !== "level" || round.gameLevel === null || round.result !== "perfect") {
        return { records, newRecords: [] };
    }

    const newRecords: RecordKey[] = [];
    let { bestLevel } = records;
    if (bestLevel === null || round.gameLevel > bestLevel) {
        bestLevel = round.gameLevel;
        newRecords.push("bestLevel");
    }

    const levelKey = String(round.gameLevel);
    const fastestMemorizeSecByLevel = { ...records.fastestMemorizeSecByLevel };
    const previousFastest = fastestMemorizeSecByLevel[levelKey];
    if (previousFastest === undefined || round.memorizeSec < previousFastest) {
        fastestMemorizeSecByLevel[levelKey] = round.memorizeSec;
        newRecords.push("fastestMemorize");
    }

    return { records: { bestLevel, fastestMemorizeSecByLevel }, newRecords };
};
