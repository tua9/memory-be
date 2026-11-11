import assert from "node:assert/strict";
import { test } from "node:test";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../src/utils/ApiError.js";
import { buildCoachAnalysis } from "../../src/Agent/coach.service.js";
import { fitPlanToProgress, markWeekProgress, parsePlan, type PlanSession } from "../../src/Agent/plan.service.js";

const session = (overrides: Partial<PlanSession> = {}): PlanSession => ({
    day: 1,
    minutes: 15,
    gameName: "number",
    level: 1,
    targetAccuracy: 80,
    tip: "Chia dãy số thành cụm 2 chữ số.",
    ...overrides,
});

const isBadRequest = (error: unknown) => error instanceof ApiError && error.statusCode === StatusCodes.BAD_REQUEST;

test("a plan keeps only known fields and trims its text", () => {
    assert.deepEqual(parsePlan({
        goal: "  Nhớ dãy số dài hơn  ",
        minutesPerDay: 15,
        savedAt: "forged",
        sessions: [{ ...session(), tip: "  Mẹo  ", bestAccuracy: 1 }],
    }), { goal: "Nhớ dãy số dài hơn", minutesPerDay: 15, sessions: [{ ...session(), tip: "Mẹo" }] });
});

test("a plan rejects unknown games, out-of-range numbers and crowded days", () => {
    const valid = { goal: "Mục tiêu", minutesPerDay: 15, sessions: [session()] };
    const invalidPlans = [
        null,
        { ...valid, sessions: [] },
        { ...valid, goal: "" },
        { ...valid, minutesPerDay: 2 },
        { ...valid, minutesPerDay: 15.5 },
        { ...valid, sessions: [session({ gameName: "chess" as PlanSession["gameName"] })] },
        { ...valid, sessions: [session({ day: 8 })] },
        { ...valid, sessions: [session({ targetAccuracy: 0.8 })] },
        { ...valid, sessions: Array.from({ length: 4 }, () => session({ minutes: 3 })) },
        { ...valid, sessions: Array.from({ length: 15 }, (_, index) => session({ day: (index % 7) + 1 })) },
    ];
    for (const plan of invalidPlans) assert.throws(() => parsePlan(plan), isBadRequest, JSON.stringify(plan));
});

test("fitting a plan caps levels at the unlocked level and each day at the minute budget", () => {
    const analysis = buildCoachAnalysis([
        { gameName: "number", unlockedLevel: 3, played: 4, perfect: 1, totalItems: 40, totalCorrect: 30, bestLevel: 2 },
    ]);
    const fitted = fitPlanToProgress({
        goal: "Nhớ số",
        minutesPerDay: 15,
        sessions: [
            session({ day: 3, level: 9 }),
            session({ day: 1, minutes: 15, gameName: "word", level: 4 }),
            session({ day: 1, minutes: 15 }),
        ],
    }, analysis);

    assert.deepEqual(fitted.sessions.map(({ day, minutes, gameName, level }) => ({ day, minutes, gameName, level })), [
        { day: 1, minutes: 7, gameName: "word", level: 1 },
        { day: 1, minutes: 7, gameName: "number", level: 1 },
        { day: 3, minutes: 15, gameName: "number", level: 3 },
    ]);
    for (let day = 1; day <= 7; day++) {
        const total = fitted.sessions.filter((item) => item.day === day).reduce((sum, item) => sum + item.minutes, 0);
        assert.ok(total <= fitted.minutesPerDay, `day ${day} is over budget`);
    }
});

test("a session counts as done when that day has a play of the same game at its level or higher", () => {
    const sessions = [session({ day: 1, level: 2 }), session({ day: 2, gameName: "word" }), session({ day: 3 })];
    const marked = markWeekProgress(sessions, [
        { day: 1, gameName: "number", level: 1, accuracy: 1 },
        { day: 1, gameName: "number", level: 3, accuracy: 0.6 },
        { day: 1, gameName: "number", level: 2, accuracy: 0.9 },
        { day: 2, gameName: "number", level: 5, accuracy: 1 },
    ]);
    assert.deepEqual(marked.map((item) => item.bestAccuracy), [0.9, null, null]);
});
