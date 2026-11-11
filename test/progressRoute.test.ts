import assert from "node:assert/strict";
import { test } from "node:test";
import { StatusCodes } from "http-status-codes";
import { createProgressRouter } from "../src/routes/progressRoute.js";
import { parseTimelineQuery, type ProgressService } from "../src/services/progress.service.js";
import { parseCoachPlanContent } from "../src/Agent/tools/coachPlan.tool.js";
import type { CoachAnalysis } from "../src/Agent/coach.service.js";
import type { Timeline } from "../src/services/timeline.service.js";
import ApiError from "../src/utils/ApiError.js";
import { TEST_USER_ID, acceptAuthentication, rejectAuthentication, startTestServer } from "./helpers/testServer.js";

const TIMELINE = { period: "month", game: "card" } as Timeline;
const COACH = { totalPlayed: 3 } as CoachAnalysis;
const SAVED_PLAN = { content: "Tập 15 phút mỗi ngày.", savedAt: new Date("2026-11-11T00:00:00.000Z") };
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
            return { reply: "Thử luyện 15 phút mỗi ngày." };
        },
        generateCoachPlan: async (...args) => {
            calls.push(args);
            return { plan: "Thứ 2 (15 phút): Luyện Gương mặt & Tên cấp 1." };
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
            data: { reply: "Thử luyện 15 phút mỗi ngày." },
        });
        assert.deepEqual(calls.at(-1), [TEST_USER_ID, { messages }]);
    } finally {
        await server.close();
    }
});

test("generating a coach plan requires authentication and passes the conversation to the user's coach", async () => {
    const { service, calls } = createRecordingService();
    const protectedServer = await startTestServer("/api/progress", createProgressRouter(rejectAuthentication, service));
    try {
        assert.equal((await fetch(`${protectedServer.baseUrl}/coach/plan/generate`, { method: "POST" })).status, StatusCodes.UNAUTHORIZED);
        assert.equal(calls.length, 0);
    } finally {
        await protectedServer.close();
    }

    const server = await startTestServer("/api/progress", createProgressRouter(acceptAuthentication, service));
    try {
        const messages = [
            { role: "user", content: "15 phút mỗi ngày, luyện Gương mặt & Tên." },
            { role: "assistant", content: "Bạn muốn nghỉ ngày nào?" },
        ];
        const response = await fetch(`${server.baseUrl}/coach/plan/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages }),
        });
        assert.equal(response.status, StatusCodes.OK);
        assert.deepEqual(await response.json(), {
            status: "success",
            data: { plan: "Thứ 2 (15 phút): Luyện Gương mặt & Tên cấp 1." },
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
            body: JSON.stringify({ content: "Tập 15 phút mỗi ngày." }),
        });
        assert.equal(saveResponse.status, StatusCodes.OK);
        assert.deepEqual(await saveResponse.json(), { status: "success", data: { savedPlan: SAVED_PLAN_RESPONSE } });
        assert.deepEqual(calls.slice(-2), [[TEST_USER_ID], [TEST_USER_ID, { content: "Tập 15 phút mỗi ngày." }]]);
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

test("saved coach plan content is trimmed and rejects invalid input", () => {
    assert.equal(parseCoachPlanContent({ content: "  Luyện 15 phút.  " }), "Luyện 15 phút.");
    for (const body of [null, {}, { content: "" }, { content: "x".repeat(3001) }, { content: "OK", savedAt: "forged" }]) {
        assert.throws(() => parseCoachPlanContent(body), isBadRequest);
    }
});
