import assert from "node:assert/strict";
import { test } from "node:test";
import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { createGameSessionRouter } from "../src/routes/gameSessionRoute.js";
import type {
    CompletedRoundView,
    GameSessionService,
    RecallRoundView,
    StartedRoundView,
} from "../src/services/gameSession.service.js";
import ApiError from "../src/utils/ApiError.js";
import {
    TEST_USER_ID,
    acceptAuthentication,
    postJson,
    rejectAuthentication,
    startTestServer,
} from "./helpers/testServer.js";

const SESSION_ID = "6719a1b2c3d4e5f6a7b8c9d0";
const GUEST_ID = "abcdefghijklmnopqrstuvwxyz012345";

// Không đăng nhập: optionalAuthentication để request.user trống
const asGuest: RequestHandler = (_request, _response, next) => next();

const postAsGuest = (url: string, body: unknown, guestId?: string) =>
    fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(guestId && { Cookie: `guestId=${guestId}` }),
        },
        body: JSON.stringify(body),
    });

const STARTED = { sessionId: SESSION_ID, status: "memorizing" } as StartedRoundView;
const RECALLING = { sessionId: SESSION_ID, status: "recalling" } as RecallRoundView;
const COMPLETED = { sessionId: SESSION_ID, status: "completed" } as CompletedRoundView;

// Service giả ghi lại các lần được gọi, để kiểm tra controller truyền đúng dữ liệu
const createRecordingService = (overrides: Partial<GameSessionService> = {}) => {
    const calls: { method: keyof GameSessionService; args: unknown[] }[] = [];
    const service: GameSessionService = {
        startRound: async (...args) => {
            calls.push({ method: "startRound", args });
            return STARTED;
        },
        startRecall: async (...args) => {
            calls.push({ method: "startRecall", args });
            return RECALLING;
        },
        submitRound: async (...args) => {
            calls.push({ method: "submitRound", args });
            return COMPLETED;
        },
        ...overrides,
    };
    return { service, calls };
};

test("an invalid or expired sign-in is rejected on every game session endpoint", async () => {
    const { service, calls } = createRecordingService();
    const server = await startTestServer("/api/game-sessions", createGameSessionRouter(rejectAuthentication, service));
    try {
        for (const path of ["", `/${SESSION_ID}/recall`, `/${SESSION_ID}/submit`]) {
            const response = await postJson(`${server.baseUrl}${path}`, {});
            assert.equal(response.status, StatusCodes.UNAUTHORIZED, path);
        }
        assert.equal(calls.length, 0);
    } finally {
        await server.close();
    }
});

test("starting a round passes the user id and request body to the service", async () => {
    const { service, calls } = createRecordingService();
    const server = await startTestServer("/api/game-sessions", createGameSessionRouter(acceptAuthentication, service));
    try {
        const body = { gameName: "card", gameLevel: 2 };
        const response = await postJson(server.baseUrl, body);
        assert.equal(response.status, StatusCodes.CREATED);
        assert.deepEqual(await response.json(), {
            status: "success",
            message: "Game round started",
            data: { session: STARTED },
        });
        assert.deepEqual(calls, [{ method: "startRound", args: [{ userId: TEST_USER_ID }, body] }]);
        // Người đã đăng nhập không cần cookie khách
        assert.equal(response.headers.get("set-cookie"), null);
    } finally {
        await server.close();
    }
});

test("a guest's first round gets a new guest cookie that later rounds keep and renew", async () => {
    const { service, calls } = createRecordingService();
    const server = await startTestServer("/api/game-sessions", createGameSessionRouter(asGuest, service));
    try {
        const body = { gameName: "image" };
        const first = await postAsGuest(server.baseUrl, body);
        assert.equal(first.status, StatusCodes.CREATED);
        const cookie = first.headers.get("set-cookie") ?? "";
        const guestId = /^guestId=([A-Za-z0-9_-]{32});/.exec(cookie)?.[1];
        assert.ok(guestId, cookie);
        assert.match(cookie, /HttpOnly/);
        assert.match(cookie, /Max-Age=86400/);

        const next = await postAsGuest(server.baseUrl, body, guestId);
        assert.match(next.headers.get("set-cookie") ?? "", new RegExp(`^guestId=${guestId};`));

        assert.deepEqual(calls, [
            { method: "startRound", args: [{ guestId }, body] },
            { method: "startRound", args: [{ guestId }, body] },
        ]);
    } finally {
        await server.close();
    }
});

test("guests recall and submit their rounds with the guest cookie", async () => {
    const { service, calls } = createRecordingService();
    const server = await startTestServer("/api/game-sessions", createGameSessionRouter(asGuest, service));
    try {
        const recall = await postAsGuest(`${server.baseUrl}/${SESSION_ID}/recall`, {}, GUEST_ID);
        assert.equal(recall.status, StatusCodes.OK);
        const body = { answers: ["lvl1_01", null] };
        const submit = await postAsGuest(`${server.baseUrl}/${SESSION_ID}/submit`, body, GUEST_ID);
        assert.equal(submit.status, StatusCodes.OK);

        assert.deepEqual(calls, [
            { method: "startRecall", args: [{ guestId: GUEST_ID }, SESSION_ID] },
            { method: "submitRound", args: [{ guestId: GUEST_ID }, SESSION_ID, body] },
        ]);
    } finally {
        await server.close();
    }
});

test("without a sign-in or a valid guest cookie no round can be continued", async () => {
    const { service, calls } = createRecordingService();
    const server = await startTestServer("/api/game-sessions", createGameSessionRouter(asGuest, service));
    try {
        for (const guestId of [undefined, "not-a-guest-id"]) {
            for (const path of [`/${SESSION_ID}/recall`, `/${SESSION_ID}/submit`]) {
                const response = await postAsGuest(`${server.baseUrl}${path}`, { answers: [] }, guestId);
                assert.equal(response.status, StatusCodes.NOT_FOUND, `${path} ${guestId}`);
            }
        }
        assert.equal(calls.length, 0);
    } finally {
        await server.close();
    }
});

test("recall and submit use the session id from the URL", async () => {
    const { service, calls } = createRecordingService();
    const server = await startTestServer("/api/game-sessions", createGameSessionRouter(acceptAuthentication, service));
    try {
        const recall = await postJson(`${server.baseUrl}/${SESSION_ID}/recall`);
        assert.equal(recall.status, StatusCodes.OK);
        assert.deepEqual((await recall.json()).data, { session: RECALLING });

        const body = { answers: ["AS", null] };
        const submit = await postJson(`${server.baseUrl}/${SESSION_ID}/submit`, body);
        assert.equal(submit.status, StatusCodes.OK);
        assert.deepEqual((await submit.json()).data, { session: COMPLETED });

        assert.deepEqual(calls, [
            { method: "startRecall", args: [{ userId: TEST_USER_ID }, SESSION_ID] },
            { method: "submitRound", args: [{ userId: TEST_USER_ID }, SESSION_ID, body] },
        ]);
    } finally {
        await server.close();
    }
});

test("service errors keep their status code and message", async () => {
    const { service } = createRecordingService({
        startRound: async () => {
            throw new ApiError(StatusCodes.FORBIDDEN, "Level 5 is locked");
        },
        submitRound: async () => {
            throw new ApiError(StatusCodes.CONFLICT, "Recall phase has not started");
        },
    });
    const server = await startTestServer("/api/game-sessions", createGameSessionRouter(acceptAuthentication, service));
    try {
        const locked = await postJson(server.baseUrl, { gameName: "card", gameLevel: 5 });
        assert.equal(locked.status, StatusCodes.FORBIDDEN);
        assert.equal((await locked.json()).message, "Level 5 is locked");

        const early = await postJson(`${server.baseUrl}/${SESSION_ID}/submit`, { answers: [] });
        assert.equal(early.status, StatusCodes.CONFLICT);
    } finally {
        await server.close();
    }
});

test("the old history endpoint by user id no longer exists", async () => {
    const { service } = createRecordingService();
    const server = await startTestServer("/api/game-sessions", createGameSessionRouter(acceptAuthentication, service));
    try {
        const response = await fetch(`${server.baseUrl}/user/${TEST_USER_ID}`);
        assert.equal(response.status, StatusCodes.NOT_FOUND);
    } finally {
        await server.close();
    }
});
