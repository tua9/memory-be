import assert from "node:assert/strict";
import { test } from "node:test";
import { gradeRound } from "../src/services/gameRules.service.js";
import {
    applyRoundToRecords,
    calculateRoundExp,
    createEmptyRecords,
    getUserLevel,
    type RecordCandidate,
} from "../src/services/progression.service.js";

const NO_BONUS = { isFirstGameOfDay: false, hasNewRecord: false };

// Ván 15 thẻ, như game card level 3
const expFor = (correctItems: number) =>
    calculateRoundExp(gradeRound({ totalItems: 15, passAccuracy: 0.7 }, correctItems), NO_BONUS);

test("round EXP follows the share of correct items, halved for failed rounds", () => {
    assert.equal(expFor(15).total, 55);
    assert.deepEqual(expFor(15).breakdown, {
        round: 45,
        perfectBonus: 10,
        firstGameOfDayBonus: 0,
        newRecordBonus: 0,
    });
    assert.equal(expFor(12).total, 36);
    assert.equal(expFor(10).total, 15);
    assert.equal(expFor(6).total, 9);
});

test("a submitted round always earns the minimum EXP", () => {
    assert.equal(expFor(0).total, 1);
});

test("first game of the day and new records add bonuses once", () => {
    const reward = calculateRoundExp(
        gradeRound({ totalItems: 15, passAccuracy: 0.7 }, 12),
        { isFirstGameOfDay: true, hasNewRecord: true },
    );
    assert.equal(reward.total, 36 + 10 + 20);
    assert.equal(reward.breakdown.firstGameOfDayBonus, 10);
    assert.equal(reward.breakdown.newRecordBonus, 20);
});

test("user level is derived from total EXP", () => {
    const cases: [exp: number, level: number, expIntoLevel: number, expForNextLevel: number][] = [
        [0, 1, 0, 100],
        [99, 1, 99, 100],
        [100, 2, 0, 200],
        [299, 2, 199, 200],
        [300, 3, 0, 300],
        [1000, 5, 0, 500],
        [4500, 10, 0, 1000],
        [4499, 9, 899, 900],
    ];
    for (const [exp, level, expIntoLevel, expForNextLevel] of cases) {
        assert.deepEqual(getUserLevel(exp), { level, expIntoLevel, expForNextLevel }, `exp ${exp}`);
    }
    assert.throws(() => getUserLevel(-1), RangeError);
    assert.throws(() => getUserLevel(Number.NaN), RangeError);
});

const perfectAt = (gameLevel: number, memorizeSec: number): RecordCandidate => ({
    mode: "level",
    gameLevel,
    result: "perfect",
    memorizeSec,
});

test("the first perfect round sets both records", () => {
    const { records, newRecords } = applyRoundToRecords(createEmptyRecords(), perfectAt(1, 50));
    assert.deepEqual(records, { bestLevel: 1, fastestMemorizeSecByLevel: { "1": 50 } });
    assert.deepEqual(newRecords, ["bestLevel", "fastestMemorize"]);
});

test("records improve only when strictly better", () => {
    const current = { bestLevel: 3, fastestMemorizeSecByLevel: { "2": 40, "3": 90 } };

    assert.deepEqual(applyRoundToRecords(current, perfectAt(2, 45)).newRecords, []);
    assert.deepEqual(applyRoundToRecords(current, perfectAt(3, 90)).newRecords, []);

    const faster = applyRoundToRecords(current, perfectAt(2, 35));
    assert.deepEqual(faster.newRecords, ["fastestMemorize"]);
    assert.equal(faster.records.bestLevel, 3);
    assert.equal(faster.records.fastestMemorizeSecByLevel["2"], 35);

    const higher = applyRoundToRecords(current, perfectAt(4, 120));
    assert.deepEqual(higher.newRecords, ["bestLevel", "fastestMemorize"]);
    assert.equal(higher.records.bestLevel, 4);

    assert.deepEqual(current, { bestLevel: 3, fastestMemorizeSecByLevel: { "2": 40, "3": 90 } });
});

test("rounds that are not perfect or not level rounds never set records", () => {
    const empty = createEmptyRecords();
    assert.deepEqual(applyRoundToRecords(empty, { ...perfectAt(1, 30), result: "pass" }).newRecords, []);
    assert.deepEqual(
        applyRoundToRecords(empty, { mode: "custom", gameLevel: null, result: "perfect", memorizeSec: 30 }).newRecords,
        [],
    );
});
