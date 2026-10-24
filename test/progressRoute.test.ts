import assert from "node:assert/strict";
import { test } from "node:test";
import { StatusCodes } from "http-status-codes";
import { createProgressRouter } from "../src/routes/progressRoute.js";
import { parseTimelineQuery, type ProgressService } from "../src/services/progress.service.js";
import type { Timeline } from "../src/services/timeline.service.js";
import ApiError from "../src/utils/ApiError.js";
import { TEST_USER_ID, acceptAuthentication, rejectAuthentication, startTestServer } from "./helpers/testServer.js";

const TIMELINE = { period: "month", game: "card" } as Timeline;

const createRecordingService = () => {
    const calls: unknown[][] = [];
    const service: ProgressService = {
        getTimeline: async (...args) => {
            calls.push(args);
            return TIMELINE;
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

test("timeline query defaults to all games by week and rejects unknown values", () => {
    assert.deepEqual(parseTimelineQuery({}), { period: "week", game: "all" });
    assert.deepEqual(parseTimelineQuery({ period: "month", game: "image" }), { period: "month", game: "image" });
    for (const query of [{ period: "day" }, { period: "toString" }, { game: "cards" }, { period: ["week"] }]) {
        assert.throws(() => parseTimelineQuery(query), isBadRequest, JSON.stringify(query));
    }
});
