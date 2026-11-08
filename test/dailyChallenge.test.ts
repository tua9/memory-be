import assert from "node:assert/strict";
import { test } from "node:test";
import { DAILY_CHALLENGE_GAMES } from "../src/config/dailyChallenge.js";
import { SEED_IMAGES } from "../src/data/seedImages.js";
import { CARD_CODES } from "../src/games/card.js";
import {
    dailyChallengeFor,
    dailyChallengeItems,
    myChallengeStatus,
    rankRounds,
} from "../src/services/dailyChallenge.service.js";
import { resolveRoundRules } from "../src/services/gameRules.service.js";
import ApiError from "../src/utils/ApiError.js";
import { createSeededRandom, shuffle } from "../src/utils/random.js";

test("a seeded random source repeats for the same seed and differs for another", () => {
    const draw = (seed: string) => {
        const random = createSeededRandom(seed);
        return Array.from({ length: 8 }, () => random(1000));
    };
    assert.deepEqual(draw("2026-11-08"), draw("2026-11-08"));
    assert.notDeepEqual(draw("2026-11-08"), draw("2026-11-09"));
    const random = createSeededRandom("bounds");
    for (let i = 0; i < 200; i += 1) {
        const value = random(7);
        assert.ok(Number.isInteger(value) && value >= 0 && value < 7);
    }
});

test("a seeded shuffle is a repeatable permutation", () => {
    const first = shuffle(CARD_CODES, createSeededRandom("deck"));
    const second = shuffle(CARD_CODES, createSeededRandom("deck"));
    assert.deepEqual(first, second);
    assert.deepEqual([...first].sort(), [...CARD_CODES].sort());
});

test("the challenge date follows Vietnam time, not UTC", () => {
    // 17:30 UTC ngày 8/11 đã là 00:30 ngày 9/11 ở Việt Nam
    assert.equal(dailyChallengeFor(new Date("2026-11-08T16:59:00Z")).date, "2026-11-08");
    assert.equal(dailyChallengeFor(new Date("2026-11-08T17:30:00Z")).date, "2026-11-09");
});

test("games take turns day by day and keep their configured rules", () => {
    const days = ["2026-11-08", "2026-11-09", "2026-11-10"].map((day) => dailyChallengeFor(new Date(`${day}T05:00:00Z`)));
    assert.notEqual(days[0].gameName, days[1].gameName);
    assert.equal(days[0].gameName, days[2].gameName);
    for (const day of days) {
        const config = DAILY_CHALLENGE_GAMES.find((game) => game.gameName === day.gameName);
        assert.equal(day.totalItems, config?.itemCount);
        assert.equal(day.memorizeLimitSec, config?.memorizeSec);
    }
});

test("everyone gets the same items on a day, and new items the next day", () => {
    const noon = (day: string) => dailyChallengeFor(new Date(`${day}T05:00:00Z`));
    const today = noon("2026-11-08");
    const items = dailyChallengeItems(today);
    assert.deepEqual(dailyChallengeItems(noon("2026-11-08")), items);
    assert.equal(items.length, today.totalItems);
    assert.equal(new Set(items).size, items.length);
    // Hai ngày cùng game (cách nhau 2 ngày) vẫn có đề khác nhau
    assert.notDeepEqual(dailyChallengeItems(noon("2026-11-10")), items);
});

test("image challenges draw from their configured pool", () => {
    const imageGame = DAILY_CHALLENGE_GAMES.find((game) => game.gameName === "image");
    assert.ok(imageGame);
    const day = ["2026-11-08", "2026-11-09"]
        .map((date) => dailyChallengeFor(new Date(`${date}T05:00:00Z`)))
        .find((challenge) => challenge.gameName === "image");
    assert.ok(day);
    const pool = new Set(SEED_IMAGES.filter((image) => image.level === imageGame.poolLevel).map((image) => image.code));
    assert.ok(dailyChallengeItems(day).every((code) => pool.has(code)));
});

test("ranking puts more correct items first, then less time, then the earlier finish", () => {
    const round = (userId: string, correctItems: number, durationSec: number, minute: number) => ({
        userId,
        correctItems,
        totalItems: 12,
        accuracy: correctItems / 12,
        memorizeSec: durationSec - 10,
        recallSec: 10,
        completedAt: new Date(`2026-11-08T05:${String(minute).padStart(2, "0")}:00Z`),
    });
    const ranked = rankRounds([
        round("slow", 12, 200, 1),
        round("fewer", 10, 50, 2),
        round("fast", 12, 90, 3),
        round("same-time-later", 12, 90, 4),
    ]);
    assert.deepEqual(
        ranked.map((entry) => [entry.userId, entry.rank]),
        [
            ["fast", 1],
            ["same-time-later", 2],
            ["slow", 3],
            ["fewer", 4],
        ],
    );
});

test("an abandoned attempt still uses up the day's turn", () => {
    const startedAt = new Date("2026-11-08T05:00:00Z");
    const rules = { mode: "daily" as const, gameLevel: null, totalItems: 12, memorizeLimitSec: 120, recallLimitSec: 300, passAccuracy: 0.7 };
    const at = (seconds: number) => new Date(startedAt.getTime() + seconds * 1000);

    assert.equal(myChallengeStatus(null, at(0)), "not-played");
    const memorizing = { status: "memorizing" as const, startedAt, recallStartedAt: null, rules };
    assert.equal(myChallengeStatus(memorizing, at(60)), "playing");
    assert.equal(myChallengeStatus(memorizing, at(600)), "missed");
    const recalling = { status: "recalling" as const, startedAt, recallStartedAt: at(100), rules };
    assert.equal(myChallengeStatus(recalling, at(200)), "playing");
    assert.equal(myChallengeStatus(recalling, at(1000)), "missed");
    assert.equal(myChallengeStatus({ ...recalling, status: "completed" }, at(1000)), "completed");
});

test("daily rounds cannot be started through the normal game session API", () => {
    assert.throws(
        () => resolveRoundRules("card", { mode: "daily" }, 1),
        (error: unknown) => error instanceof ApiError && error.statusCode === 400,
    );
});
