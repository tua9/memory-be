import assert from "node:assert/strict";
import test from "node:test";
import { decideRoundWinner } from "../src/services/gameRoom.service.js";
import { summarizeActivities } from "../src/services/familyReport.service.js";

test("round winner compares correct positions before measured milliseconds", () => {
    const pair = (a: [number, number], b: [number, number]) =>
        decideRoundWinner([{ id: "a", correct: a[0], usedMs: a[1] }, { id: "b", correct: b[0], usedMs: b[1] }]);
    assert.equal(pair([4, 30_000], [3, 1_000]), "a");
    assert.equal(pair([4, 2_001], [4, 2_000]), "b");
    assert.equal(pair([4, 2_000], [4, 2_000]), "draw");
    assert.equal(pair([0, 1_000], [0, 30_000]), "draw");
});

test("child summary weighs positions and counts Vietnam calendar days", () => {
    const result = summarizeActivities([
        { gameName: "card", completedAt: new Date("2026-11-08T17:30:00Z"), totalItems: 10, correctItems: 8, durationSec: 60 },
        { gameName: "card", completedAt: new Date("2026-11-08T18:00:00Z"), totalItems: 2, correctItems: 0, durationSec: 10 },
        { gameName: "word", completedAt: new Date("2026-11-09T18:00:00Z"), totalItems: 4, correctItems: 4, durationSec: 20 },
    ]);
    assert.equal(result.games, 3);
    assert.equal(result.practiceDays, 2);
    assert.equal(result.accuracy, 12 / 16);
    assert.equal(result.recordedPracticeSeconds, 90);
    assert.deepEqual(result.byGame.find((entry) => entry.gameName === "card"), { gameName: "card", games: 2, correct: 8, total: 12 });
});
