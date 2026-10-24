import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIGURED_GAME_NAMES, GAME_CONFIGS } from "../src/config/games.js";
import {
    getItemCountForLevel,
    getUnlockedLevelAfterRound,
    gradeRound,
    isConfiguredGame,
    parseGameName,
    resolveRoundRules,
} from "../src/services/gameRules.service.js";
import ApiError from "../src/utils/ApiError.js";

const isApiError = (statusCode: number) => (error: unknown) =>
    error instanceof ApiError && error.statusCode === statusCode;

test("game configs are internally consistent", () => {
    for (const gameName of CONFIGURED_GAME_NAMES) {
        const config = GAME_CONFIGS[gameName];
        const counts = config.itemsPerLevel;
        assert.ok(counts.length > 0, `${gameName} needs at least one level`);
        counts.forEach((count, index) => {
            assert.ok(Number.isInteger(count) && count > 0, `${gameName} level ${index + 1} count`);
            if (index > 0) {
                assert.ok(count > counts[index - 1], `${gameName} levels must get harder`);
            }
        });
        assert.ok(
            (config.memorizeSecOptions as readonly number[]).includes(config.defaultMemorizeSec),
            `${gameName} default memorize time must be one of the options`,
        );
        assert.ok(config.passAccuracy > 0 && config.passAccuracy < 1);
        if (config.customItems) {
            assert.ok(config.customItems.min <= config.customItems.max);
        }
    }
});

test("only configured games are accepted", () => {
    assert.equal(isConfiguredGame("card"), true);
    assert.equal(isConfiguredGame("image"), true);
    assert.equal(isConfiguredGame("number"), false);
    assert.equal(isConfiguredGame("toString"), false);
    assert.equal(isConfiguredGame(1), false);
    assert.equal(parseGameName("card"), "card");
    assert.throws(() => parseGameName("cards"), isApiError(400));
});

test("item count follows the level table", () => {
    assert.equal(getItemCountForLevel("card", 1), 5);
    assert.equal(getItemCountForLevel("card", 3), 15);
    assert.equal(getItemCountForLevel("card", 10), 52);
    assert.equal(getItemCountForLevel("image", 1), 6);
    assert.equal(getItemCountForLevel("image", 10), 24);
    for (const level of [0, 11, 1.5]) {
        assert.throws(() => getItemCountForLevel("card", level), RangeError);
    }
});

test("a level round defaults to the highest unlocked level and default memorize time", () => {
    assert.deepEqual(resolveRoundRules("card", {}, 3), {
        gameName: "card",
        mode: "level",
        gameLevel: 3,
        totalItems: 15,
        memorizeLimitSec: 120,
        recallLimitSec: 300,
        passAccuracy: 0.7,
    });
});

test("players can replay lower levels but not locked ones", () => {
    assert.equal(resolveRoundRules("image", { gameLevel: 1, memorizeSec: 30 }, 4).totalItems, 6);
    assert.throws(() => resolveRoundRules("image", { gameLevel: 5 }, 4), isApiError(403));
    for (const gameLevel of [0, 11, 2.5, "2"]) {
        assert.throws(() => resolveRoundRules("image", { gameLevel }, 10), isApiError(400));
    }
});

test("unlocked level above the current max level is capped", () => {
    assert.equal(resolveRoundRules("card", {}, 99).gameLevel, 10);
});

test("memorize time must be one of the configured options", () => {
    assert.throws(() => resolveRoundRules("card", { memorizeSec: 45 }, 1), isApiError(400));
    assert.throws(() => resolveRoundRules("card", { memorizeSec: "60" }, 1), isApiError(400));
});

test("custom rounds use the chosen item count and have no level", () => {
    const rules = resolveRoundRules("card", { mode: "custom", itemCount: 30 }, 1);
    assert.equal(rules.gameLevel, null);
    assert.equal(rules.totalItems, 30);

    for (const itemCount of [4, 53, 10.5, undefined]) {
        assert.throws(() => resolveRoundRules("card", { mode: "custom", itemCount }, 1), isApiError(400));
    }
    assert.throws(
        () => resolveRoundRules("card", { mode: "custom", itemCount: 30, gameLevel: 1 }, 1),
        isApiError(400),
    );
    assert.throws(() => resolveRoundRules("image", { mode: "custom", itemCount: 10 }, 1), isApiError(400));
});

test("item count and unknown modes are rejected in level rounds", () => {
    assert.throws(() => resolveRoundRules("card", { itemCount: 20 }, 1), isApiError(400));
    assert.throws(() => resolveRoundRules("card", { mode: "practice" }, 1), isApiError(400));
});

test("rounds are graded as perfect, pass or fail", () => {
    const rules = { totalItems: 15, passAccuracy: 0.7 };
    assert.equal(gradeRound(rules, 15).result, "perfect");
    assert.equal(gradeRound(rules, 12).result, "pass");
    assert.equal(gradeRound(rules, 10).result, "fail");
    assert.equal(gradeRound(rules, 0).accuracy, 0);
    assert.equal(gradeRound({ totalItems: 10, passAccuracy: 0.7 }, 7).result, "pass");

    assert.throws(() => gradeRound(rules, 16), RangeError);
    assert.throws(() => gradeRound(rules, -1), RangeError);
    assert.throws(() => gradeRound({ totalItems: 0, passAccuracy: 0.7 }, 0), RangeError);
});

test("the next level unlocks only after a perfect round at the highest unlocked level", () => {
    const atLevel = (gameLevel: number) => ({ gameName: "card" as const, mode: "level" as const, gameLevel });

    assert.equal(getUnlockedLevelAfterRound(atLevel(3), "perfect", 3), 4);
    assert.equal(getUnlockedLevelAfterRound(atLevel(3), "pass", 3), 3);
    assert.equal(getUnlockedLevelAfterRound(atLevel(2), "perfect", 3), 3);
    assert.equal(getUnlockedLevelAfterRound(atLevel(10), "perfect", 10), 10);
    assert.equal(
        getUnlockedLevelAfterRound({ gameName: "card", mode: "custom", gameLevel: null }, "perfect", 3),
        3,
    );
});
