import assert from "node:assert/strict";
import { test } from "node:test";
import { StatusCodes } from "http-status-codes";
import { createProgressRouter } from "../src/routes/progressRoute.js";
import { parseTimelineQuery, type ProgressService } from "../src/services/progress.service.js";
import type { CoachPlanView } from "../src/Agent/tools/coachPlan.tool.js";
import type { CoachAnalysis } from "../src/Agent/coach.service.js";
import type { Timeline } from "../src/services/timeline.service.js";
import ApiError from "../src/utils/ApiError.js";
import { TEST_USER_ID, acceptAuthentication, rejectAuthentication, startTestServer } from "./helpers/testServer.js";

const TIMELINE = { period: "month", game: "card" } as Timeline;
const COACH = { totalPlayed: 3 } as CoachAnalysis;
const PLAN = {
    goal: "Nhớ dãy số dài hơn",
    minutesPerDay: 15,
    sessions: [{ day: 1, minutes: 15, gameName: "number", level: 1, targetAccuracy: 80, tip: "Chia cụm 2 chữ số." }],
} as const;
const SAVED_PLAN: CoachPlanView = {
    ...PLAN,
    sessions: [{ ...PLAN.sessions[0], bestAccuracy: null }],
    savedAt: new Date("2026-11-11T00:00:00.000Z"),
    weekStart: "2026-11-09",
    today: 3,
};
const SAVED_PLAN_RESPONSE = { ...SAVED_PLAN, savedAt: SAVED_PLAN.savedAt.toISOString() };

const createRecordingService = () => {
    const calls: unknown[][] = [];
    const service: ProgressService = {
        getTimeline: async (...args) => {
            calls.push(args);
            return TIMELINE;
        },
        getCoach: async (...args) => {
            calls.push(args);
            return COACH;
        },
        chat: async (...args) => {
            calls.push(args);
            return { reply: "Thử luyện 15 phút mỗi ngày.", plan: null };
        },
        getCoachPlan: async (...args) => {
            calls.push(args);
            return SAVED_PLAN;
        },
        saveCoachPlan: async (...args) => {
            calls.push(args);
            return SAVED_PLAN;
        },
    };
    return { service, calls };
};

const isBadRequest = (error: unknown) => error instanceof ApiError && error.statusCode === StatusCodes.BAD_REQUEST;

test("the timeline requires an authenticated user", async () => {
    const { service, calls } = createRecordingService();
    const server = await startTestServer("/api/progress", createProgressRouter(rejectAuthentication, service));
    try {
        assert.equal((await fetch(`${server.baseUrl}/timeline`)).status, StatusCodes.UNAUTHORIZED);
        assert.equal(calls.length, 0);
    } finally {
        await server.close();
    }
});

test("the timeline passes the user id and query to the service", async () => {
    const { service, calls } = createRecordingService();
    const server = await startTestServer("/api/progress", createProgressRouter(acceptAuthentication, service));
    try {
        const response = await fetch(`${server.baseUrl}/timeline?period=month&game=card`);
        assert.equal(response.status, StatusCodes.OK);
        assert.deepEqual(await response.json(), { status: "success", data: { timeline: TIMELINE } });
        assert.equal(calls[0][0], TEST_USER_ID);
        assert.deepEqual({ ...(calls[0][1] as object) }, { period: "month", game: "card" });
    } finally {
        await server.close();
    }
});

test("the coach requires authentication and analyzes the authenticated user's progress", async () => {
    const { service, calls } = createRecordingService();
    const protectedServer = await startTestServer("/api/progress", createProgressRouter(rejectAuthentication, service));
    try {
        assert.equal((await fetch(`${protectedServer.baseUrl}/coach`)).status, StatusCodes.UNAUTHORIZED);
        assert.equal(calls.length, 0);
    } finally {
        await protectedServer.close();
    }

    const server = await startTestServer("/api/progress", createProgressRouter(acceptAuthentication, service));
    try {
        const response = await fetch(`${server.baseUrl}/coach`);
        assert.equal(response.status, StatusCodes.OK);
        assert.deepEqual(await response.json(), { status: "success", data: { analysis: COACH } });
        assert.deepEqual(calls.at(-1), [TEST_USER_ID]);
    } finally {
        await server.close();
    }
});

test("the coach chat requires authentication and passes the request to the user's coach", async () => {
    const { service, calls } = createRecordingService();
    const protectedServer = await startTestServer("/api/progress", createProgressRouter(rejectAuthentication, service));
    try {
        assert.equal((await fetch(`${protectedServer.baseUrl}/coach/chat`, { method: "POST" })).status, StatusCodes.UNAUTHORIZED);
        assert.equal(calls.length, 0);
    } finally {
        await protectedServer.close();
    }

    const server = await startTestServer("/api/progress", createProgressRouter(acceptAuthentication, service));
    try {
        const messages = [{ role: "user", content: "Mỗi ngày tôi có 15 phút." }];
        const response = await fetch(`${server.baseUrl}/coach/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages }),
        });
        assert.equal(response.status, StatusCodes.OK);
        assert.deepEqual(await response.json(), {
            status: "success",
            data: { reply: "Thử luyện 15 phút mỗi ngày.", plan: null },
        });
        assert.deepEqual(calls.at(-1), [TEST_USER_ID, { messages }]);
    } finally {
        await server.close();
    }
});

test("the saved coach plan requires authentication and is scoped to the current user", async () => {
    const { service, calls } = createRecordingService();
    const protectedServer = await startTestServer("/api/progress", createProgressRouter(rejectAuthentication, service));
    try {
        assert.equal((await fetch(`${protectedServer.baseUrl}/coach/plan`)).status, StatusCodes.UNAUTHORIZED);
        assert.equal((await fetch(`${protectedServer.baseUrl}/coach/plan`, { method: "PUT" })).status, StatusCodes.UNAUTHORIZED);
        assert.equal(calls.length, 0);
    } finally {
        await protectedServer.close();
    }

    const server = await startTestServer("/api/progress", createProgressRouter(acceptAuthentication, service));
    try {
        const getResponse = await fetch(`${server.baseUrl}/coach/plan`);
        assert.equal(getResponse.status, StatusCodes.OK);
        assert.deepEqual(await getResponse.json(), { status: "success", data: { savedPlan: SAVED_PLAN_RESPONSE } });

        const saveResponse = await fetch(`${server.baseUrl}/coach/plan`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(PLAN),
        });
        assert.equal(saveResponse.status, StatusCodes.OK);
        assert.deepEqual(await saveResponse.json(), { status: "success", data: { savedPlan: SAVED_PLAN_RESPONSE } });
        assert.deepEqual(calls.slice(-2), [[TEST_USER_ID], [TEST_USER_ID, PLAN]]);
    } finally {
        await server.close();
    }
});

test("timeline query defaults to all games by week and rejects unknown values", () => {
    assert.deepEqual(parseTimelineQuery({}), { period: "week", game: "all" });
    assert.deepEqual(parseTimelineQuery({ period: "month", game: "image" }), { period: "month", game: "image" });
    for (const query of [{ period: "day" }, { period: "toString" }, { game: "cards" }, { period: ["week"] }]) {
        assert.throws(() => parseTimelineQuery(query), isBadRequest, JSON.stringify(query));
    }
});
