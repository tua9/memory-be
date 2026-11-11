import assert from "node:assert/strict";
import { test } from "node:test";
import { cupsFor, decideRoundWinner, placeAll } from "../src/services/gameRoom.service.js";

const player = (id: string, points: number, correct = 0, left = false) => ({ id, points, correct, left });

test("cups by placement follow the table for 2 to 5 players", () => {
    assert.deepEqual(cupsFor({ a: 1, b: 2 }), { a: 2, b: -1 });
    assert.deepEqual(cupsFor({ a: 1, b: 2, c: 3 }), { a: 2, b: 0, c: -1 });
    assert.deepEqual(cupsFor({ a: 1, b: 2, c: 3, d: 4 }), { a: 2, b: 1, c: 0, d: -1 });
    assert.deepEqual(cupsFor({ a: 1, b: 2, c: 3, d: 4, e: 5 }), { a: 2, b: 1, c: 0, d: -1, e: -2 });
});

test("tied players share the average of their places, rounded down", () => {
    // Hai người hoà: (2 + -1) / 2 = 0.5 -> 0
    assert.deepEqual(cupsFor({ a: 1, b: 1 }), { a: 0, b: 0 });
    // 5 người, hai người cùng hạng 2: (1 + 0) / 2 -> 0
    assert.deepEqual(cupsFor({ a: 1, b: 2, c: 2, d: 4, e: 5 }), { a: 2, b: 0, c: 0, d: -1, e: -2 });
    // 3 người cùng hạng 1: (2 + 0 - 1) / 3 -> 0
    assert.deepEqual(cupsFor({ a: 1, b: 1, c: 1 }), { a: 0, b: 0, c: 0 });
});

test("placement ranks by points, then correct answers, and puts leavers last", () => {
    assert.deepEqual(placeAll([player("a", 3, 9), player("b", 5, 4), player("c", 3, 9)]), { a: 2, b: 1, c: 2 });
    assert.deepEqual(placeAll([player("a", 3, 9), player("b", 3, 7)]), { a: 1, b: 2 });
    // Người rời trận đứng sau dù nhiều điểm hơn
    assert.deepEqual(placeAll([player("a", 8, 20, true), player("b", 0, 0), player("c", 1, 2)]), { a: 3, b: 2, c: 1 });
});

test("round winner works for more than two players", () => {
    const answers = [
        { id: "a", correct: 4, usedMs: 9000 },
        { id: "b", correct: 4, usedMs: 7000 },
        { id: "c", correct: 2, usedMs: 1000 },
    ];
    assert.equal(decideRoundWinner(answers), "b");
    assert.equal(decideRoundWinner(answers.map((answer) => ({ ...answer, correct: 0 }))), "draw");
});
