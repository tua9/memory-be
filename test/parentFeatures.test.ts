import assert from "node:assert/strict";
import test from "node:test";
import { decideRoundWinner } from "../src/services/familyRoom.service.js";
import { summarizeParentActivities } from "../src/services/parentReport.service.js";

test("round winner compares correct positions before measured milliseconds", () => {
    assert.equal(decideRoundWinner({ correct: 4, usedMs: 30_000 }, { correct: 3, usedMs: 1_000 }), "parent");
    assert.equal(decideRoundWinner({ correct: 4, usedMs: 2_001 }, { correct: 4, usedMs: 2_000 }), "child");
    assert.equal(decideRoundWinner({ correct: 4, usedMs: 2_000 }, { correct: 4, usedMs: 2_000 }), "draw");
    assert.equal(decideRoundWinner({ correct: 0, usedMs: 1_000 }, { correct: 0, usedMs: 30_000 }), "draw");
});

test("parent summary weighs positions and counts Vietnam calendar days", () => {
    const result = summarizeParentActivities([
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
