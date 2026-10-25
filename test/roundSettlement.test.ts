import assert from "node:assert/strict";
import { test } from "node:test";
import type { UserProgress } from "../src/models/user.js";
import type { GameProgress } from "../src/models/userGameProgress.js";
import {
    compareAnswers,
    createInitialGameProgress,
    createInitialUserProgress,
    measureRoundTime,
    settleRound,
    type SettleRoundInput,
    type StoredRoundRules,
} from "../src/services/roundSettlement.service.js";

// Mốc thời gian viết theo giờ Việt Nam cho dễ đọc
const vn = (dateTime: string) => new Date(`${dateTime}+07:00`);

const LEVEL_1_CARD_RULES: StoredRoundRules = {
    mode: "level",
    gameLevel: 1,
    totalItems: 5,
    memorizeLimitSec: 120,
    recallLimitSec: 300,
    passAccuracy: 0.7,
};
const ITEMS = ["AS", "2H", "3D", "4C", "5S"];

const roundInput = (overrides: Partial<SettleRoundInput> = {}): SettleRoundInput => ({
    gameName: "card",
    rules: LEVEL_1_CARD_RULES,
    items: ITEMS,
    answers: ITEMS,
    startedAt: vn("2026-10-24T08:00:00"),
    recallStartedAt: vn("2026-10-24T08:00:40"),
    completedAt: vn("2026-10-24T08:01:30"),
    ...overrides,
});

const freshProgress = () => ({
    gameProgress: createInitialGameProgress(),
    userProgress: createInitialUserProgress(),
});

test("answers are compared position by position", () => {
    assert.deepEqual(compareAnswers(["AS", "2H", "3D"], ["AS", "3D", null]), [
        { expected: "AS", answer: "AS", correct: true },
        { expected: "2H", answer: "3D", correct: false },
        { expected: "3D", answer: null, correct: false },
    ]);
});

test("phase times are measured by the server and capped at the round limits", () => {
    const rules = { memorizeLimitSec: 60, recallLimitSec: 180 };
    assert.deepEqual(
        measureRoundTime(rules, vn("2026-10-24T08:00:00"), vn("2026-10-24T08:00:41.6"), vn("2026-10-24T08:02:00")),
        { memorizeSec: 42, recallSec: 78 },
    );
    assert.deepEqual(
        measureRoundTime(rules, vn("2026-10-24T08:00:00"), vn("2026-10-24T08:05:00"), vn("2026-10-24T08:15:00")),
        { memorizeSec: 60, recallSec: 180 },
    );
});

test("a first perfect round unlocks the next level, sets records and earns every bonus", () => {
    const settlement = settleRound(roundInput(), freshProgress());

    assert.equal(settlement.graded.result, "perfect");
    assert.equal(settlement.memorizeSec, 40);
    assert.equal(settlement.recallSec, 50);
    assert.deepEqual(settlement.rewards, {
        exp: {
            total: 55,
            breakdown: { round: 15, perfectBonus: 10, firstGameOfDayBonus: 10, newRecordBonus: 20 },
        },
        newRecords: ["bestLevel", "fastestMemorize"],
        unlockedLevel: { before: 1, after: 2 },
        userLevel: { before: 1, after: 1 },
        streak: { currentStreak: 1, longestStreak: 1 },
    });
    assert.deepEqual(settlement.gameProgress, {
        unlockedLevel: 2,
        stats: {
            played: 1,
            perfect: 1,
            pass: 0,
            fail: 0,
            totalItems: 5,
            totalCorrect: 5,
            totalMemorizeSec: 40,
            totalRecallSec: 50,
            lastPlayedAt: vn("2026-10-24T08:01:30"),
        },
        records: { bestLevel: 1, fastestMemorizeSecByLevel: { "1": 40 } },
    });
    assert.deepEqual(settlement.userProgress, {
        exp: 55,
        currentStreak: 1,
        longestStreak: 1,
        lastPlayedDate: "2026-10-24",
        totalGames: 1,
        totalPlayTimeSec: 90,
    });
});

test("a failed round later the same day earns reduced EXP and changes no level or record", () => {
    const first = settleRound(roundInput(), freshProgress());
    const second = settleRound(
        roundInput({
            rules: { ...LEVEL_1_CARD_RULES, gameLevel: 2, totalItems: 5 },
            answers: ["AS", "2H", null, null, null],
            startedAt: vn("2026-10-24T20:00:00"),
            recallStartedAt: vn("2026-10-24T20:01:00"),
            completedAt: vn("2026-10-24T20:02:00"),
        }),
        { gameProgress: first.gameProgress, userProgress: first.userProgress },
    );

    assert.equal(second.graded.result, "fail");
    assert.equal(second.rewards.exp.total, 3);
    assert.deepEqual(second.rewards.newRecords, []);
    assert.deepEqual(second.rewards.unlockedLevel, { before: 2, after: 2 });
    assert.equal(second.gameProgress.stats.played, 2);
    assert.equal(second.gameProgress.stats.fail, 1);
    assert.equal(second.userProgress.exp, 58);
    assert.equal(second.userProgress.currentStreak, 1);
});

test("custom rounds earn EXP and count as played but never unlock levels or set records", () => {
    const settlement = settleRound(
        roundInput({ rules: { ...LEVEL_1_CARD_RULES, mode: "custom", gameLevel: null } }),
        freshProgress(),
    );

    assert.equal(settlement.graded.result, "perfect");
    assert.deepEqual(settlement.rewards.newRecords, []);
    assert.deepEqual(settlement.rewards.unlockedLevel, { before: 1, after: 1 });
    assert.equal(settlement.rewards.exp.total, 15 + 10 + 10);
    assert.equal(settlement.gameProgress.stats.played, 1);
    assert.equal(settlement.gameProgress.records.bestLevel, null);
});

test("playing on the next day extends the streak and the account can level up", () => {
    const current: { gameProgress: GameProgress; userProgress: UserProgress } = {
        gameProgress: createInitialGameProgress(),
        userProgress: {
            ...createInitialUserProgress(),
            exp: 90,
            currentStreak: 3,
            longestStreak: 3,
            lastPlayedDate: "2026-10-23",
            totalGames: 12,
        },
    };
    const settlement = settleRound(roundInput(), current);

    assert.deepEqual(settlement.rewards.streak, { currentStreak: 4, longestStreak: 4 });
    assert.deepEqual(settlement.rewards.userLevel, { before: 1, after: 2 });
    assert.equal(settlement.userProgress.totalGames, 13);
});

test("the current progress is not mutated", () => {
    const current = freshProgress();
    const snapshot = structuredClone(current);
    settleRound(roundInput(), current);
    assert.deepEqual(current, snapshot);
});
