import assert from "node:assert/strict";
import { test } from "node:test";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import { createGameHistoryRouter } from "../src/routes/gameHistoryRoute.js";
import {
    DEFAULT_HISTORY_LIMIT,
    encodeHistoryCursor,
    parseHistoryQuery,
    type GameHistoryService,
    type HistoryPage,
    type SessionDetailView,
} from "../src/services/gameHistory.service.js";
import ApiError from "../src/utils/ApiError.js";
import { TEST_USER_ID, acceptAuthentication, rejectAuthentication, startTestServer } from "./helpers/testServer.js";

const SESSION_ID = "6719a1b2c3d4e5f6a7b8c9d0";
const PAGE: HistoryPage = { items: [], nextCursor: null };
const DETAIL = { sessionId: SESSION_ID, status: "recalling" } as SessionDetailView;

const isBadRequest = (error: unknown) => error instanceof ApiError && error.statusCode === StatusCodes.BAD_REQUEST;

const createRecordingService = () => {
    const calls: { method: keyof GameHistoryService; args: unknown[] }[] = [];
    const service: GameHistoryService = {
        listHistory: async (...args) => {
            calls.push({ method: "listHistory", args });
            return PAGE;
        },
        getSessionDetail: async (...args) => {
            calls.push({ method: "getSessionDetail", args });
            return DETAIL;
        },
    };
    return { service, calls };
};

test("history endpoints require an authenticated user", async () => {
    const { service, calls } = createRecordingService();
    const server = await startTestServer("/api/game-sessions", createGameHistoryRouter(rejectAuthentication, service));
    try {
        for (const path of ["", `/${SESSION_ID}`]) {
            assert.equal((await fetch(`${server.baseUrl}${path}`)).status, StatusCodes.UNAUTHORIZED, path);
        }
        assert.equal(calls.length, 0);
    } finally {
        await server.close();
    }
});

test("history list and detail pass the user id, query and session id to the service", async () => {
    const { service, calls } = createRecordingService();
    const server = await startTestServer("/api/game-sessions", createGameHistoryRouter(acceptAuthentication, service));
    try {
        const list = await fetch(`${server.baseUrl}?game=card&limit=10`);
        assert.equal(list.status, StatusCodes.OK);
        assert.deepEqual(await list.json(), { status: "success", data: PAGE });

        const detail = await fetch(`${server.baseUrl}/${SESSION_ID}`);
        assert.equal(detail.status, StatusCodes.OK);
        assert.deepEqual((await detail.json()).data, { session: DETAIL });

        const [listCall, detailCall] = calls;
        assert.equal(listCall.method, "listHistory");
        assert.equal(listCall.args[0], TEST_USER_ID);
        // Express tạo request.query không có prototype, nên chép sang object thường trước khi so sánh
        assert.deepEqual({ ...(listCall.args[1] as object) }, { game: "card", limit: "10" });
        assert.deepEqual(detailCall, { method: "getSessionDetail", args: [TEST_USER_ID, SESSION_ID] });
    } finally {
        await server.close();
    }
});

test("history query has sensible defaults", () => {
    assert.deepEqual(parseHistoryQuery({}), {
        gameName: undefined,
        from: undefined,
        to: undefined,
        limit: DEFAULT_HISTORY_LIMIT,
        cursor: undefined,
    });
});

test("history query parses game, date range and limit", () => {
    const query = parseHistoryQuery({
        game: "image",
        from: "2026-10-01T00:00:00+07:00",
        to: "2026-11-01T00:00:00+07:00",
        limit: "50",
    });
    assert.equal(query.gameName, "image");
    assert.equal(query.from?.toISOString(), "2026-09-30T17:00:00.000Z");
    assert.equal(query.to?.toISOString(), "2026-10-31T17:00:00.000Z");
    assert.equal(query.limit, 50);
});

test("invalid history queries are rejected", () => {
    for (const query of [
        { game: "cards" },
        { limit: "0" },
        { limit: "51" },
        { limit: "abc" },
        { limit: "5.5" },
        { from: "yesterday" },
        { from: ["2026-10-01", "2026-10-02"] },
        { from: "2026-10-02", to: "2026-10-01" },
        { cursor: "not-a-cursor" },
    ]) {
        assert.throws(() => parseHistoryQuery(query), isBadRequest, JSON.stringify(query));
    }
});

test("a cursor from one page can be read back for the next page", () => {
    const sessionId = new Types.ObjectId(SESSION_ID);
    const completedAt = new Date("2026-10-24T01:02:03.004Z");
    const { cursor } = parseHistoryQuery({ cursor: encodeHistoryCursor({ completedAt, sessionId }) });
    assert.equal(cursor?.completedAt.toISOString(), completedAt.toISOString());
    assert.equal(cursor?.sessionId.toString(), SESSION_ID);
});
