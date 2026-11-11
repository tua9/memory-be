import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCoachAnalysis, type StoredCoachProgress } from "../../src/Agent/coach.service.js";

const record = (
    gameName: StoredCoachProgress["gameName"],
    played: number,
    totalItems: number,
    totalCorrect: number,
    unlockedLevel = 1,
): StoredCoachProgress => ({
    gameName,
    unlockedLevel,
    played,
    perfect: played > 0 ? 1 : 0,
    totalItems,
    totalCorrect,
    bestLevel: played > 0 ? 1 : null,
});

test("coach weighs accuracy by completed items and builds a focused weekly plan", () => {
    const analysis = buildCoachAnalysis([
        record("card", 4, 40, 36, 4),
        record("image", 3, 30, 15, 2),
    ]);

    assert.equal(analysis.totalPlayed, 7);
    assert.equal(analysis.overallAccuracy, 51 / 70);
    assert.equal(analysis.skillLevel, "building");
    assert.equal(analysis.strongestGame, "card");
    assert.equal(analysis.focusGame, "image");
    assert.deepEqual(analysis.plan.map(({ day }) => day), [1, 3, 5]);
    assert.equal(analysis.plan[0].gameName, "image");
    assert.equal(analysis.plan[0].level, 2);
    assert.equal(analysis.plan[1].gameName, "card");
    assert.equal(analysis.games.length, 5);
});

test("coach returns an honest starter plan when the player has no game history", () => {
    const analysis = buildCoachAnalysis([]);
    assert.equal(analysis.totalPlayed, 0);
    assert.equal(analysis.overallAccuracy, null);
    assert.equal(analysis.skillLevel, "new");
    assert.equal(analysis.focusGame, null);
    assert.equal(analysis.plan.length, 3);
    assert.ok(analysis.plan.every(({ gameName, level }) => gameName === "card" && level === 1));
});
