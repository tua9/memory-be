import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express, { type RequestHandler } from "express";
import { errorHandlingMiddleware } from "../src/middlewares/errorHandlingMiddleware.js";
import type { GameSessionDocument } from "../src/models/gameSession.js";
import type { UserDocument } from "../src/models/user.js";
import gameSessionRouter, { createGameSessionRouter } from "../src/routes/gameSessionRoute.js";
import {
    GameSessionService,
    type GameSessionRepository,
    type UserProgress,
} from "../src/services/gameSession.service.js";

const USER_A = "507f1f77bcf86cd799439011";
const USER_B = "507f1f77bcf86cd799439012";

const makeSession = (score: number, date: string): Pick<GameSessionDocument, "score" | "date"> => ({
    score,
    date: new Date(date),
});

const makeHarness = (
    initialSessions: Record<string, Pick<GameSessionDocument, "score" | "date">[]> = {},
    userIds: string[] = [USER_A, USER_B],
) => {
    const sessions = new Map(Object.entries(initialSessions));
    const progress = new Map<string, UserProgress>();
    let updateCount = 0;
    let createCount = 0;
    const repository: GameSessionRepository = {
        userExists: async (userId) => userIds.includes(userId),
        createSession: async (input) => {
            createCount += 1;
            const created = {
                ...input,
                score: input.score ?? 0,
                date: new Date("2025-01-01T12:00:00.000Z"),
            } as GameSessionDocument;
            sessions.set(input.userId, [...(sessions.get(input.userId) ?? []), created]);
            return created;
        },
        getSessionsByUserId: async (userId) => sessions.get(userId) ?? [],
        updateUserProgress: async (userId, value) => {
            if (!userIds.includes(userId)) return false;
            updateCount += 1;
            progress.set(userId, value);
            return true;
        },
    };

    return {
        service: new GameSessionService(repository),
        progress,
        get updateCount() { return updateCount; },
        get createCount() { return createCount; },
    };
};

test("first play, consecutive days, and missed days produce the expected streak", async () => {
    const firstPlay = makeHarness({ [USER_A]: [makeSession(5, "2025-02-01T23:30:00.000Z")] });
    assert.deepEqual(await firstPlay.service.syncUserProgress(USER_A), {
        exp: 5,
        streaks: 1,
        lastActiveDate: new Date("2025-02-01T23:30:00.000Z"),
    });

    const consecutive = makeHarness({ [USER_A]: [
        makeSession(2, "2025-02-01T23:30:00.000Z"),
        makeSession(3, "2025-02-02T00:15:00.000Z"),
    ] });
    assert.equal((await consecutive.service.syncUserProgress(USER_A)).streaks, 2);

    const missedDay = makeHarness({ [USER_A]: [
        makeSession(2, "2025-02-01T10:00:00.000Z"),
        makeSession(3, "2025-02-02T10:00:00.000Z"),
        makeSession(7, "2025-02-04T10:00:00.000Z"),
    ] });
    assert.equal((await missedDay.service.syncUserProgress(USER_A)).streaks, 1);
});

test("multiple games on one UTC day count all scores but only one active day", async () => {
    const harness = makeHarness({ [USER_A]: [
        makeSession(6, "2025-03-08T02:00:00.000Z"),
        makeSession(4, "2025-03-08T19:00:00.000Z"),
        makeSession(3, "2025-03-09T01:00:00.000Z"),
    ] });

    assert.deepEqual(await harness.service.syncUserProgress(USER_A), {
        exp: 13,
        streaks: 2,
        lastActiveDate: new Date("2025-03-09T01:00:00.000Z"),
    });
});

test("recalculating progress is idempotent and keeps users isolated", async () => {
    const harness = makeHarness({
        [USER_A]: [makeSession(8, "2025-04-01T09:00:00.000Z"), makeSession(2, "2025-04-02T09:00:00.000Z")],
        [USER_B]: [makeSession(1, "2025-04-02T09:00:00.000Z")],
    });

    const firstA = await harness.service.syncUserProgress(USER_A);
    const secondA = await harness.service.syncUserProgress(USER_A);
    const progressB = await harness.service.syncUserProgress(USER_B);
    assert.deepEqual(secondA, firstA);
    assert.deepEqual(harness.progress.get(USER_A), { ...firstA });
    assert.equal(harness.progress.get(USER_A)?.exp, 10);
    assert.equal(harness.progress.get(USER_A)?.streaks, 2);
    assert.equal(progressB.exp, 1);
    assert.equal(progressB.streaks, 1);
});

test("users without sessions reset to zero and missing users are rejected", async () => {
    const harness = makeHarness({ [USER_A]: [] }, [USER_A]);
    assert.deepEqual(await harness.service.syncUserProgress(USER_A), {
        exp: 0,
        streaks: 0,
        lastActiveDate: null,
    });
    assert.deepEqual(harness.progress.get(USER_A), { exp: 0, streaks: 0, lastActiveDate: null });
    await assert.rejects(harness.service.syncUserProgress(USER_B), /Session owner was not found/);
    await assert.rejects(harness.service.createSession({
        userId: USER_B,
        gameName: "card",
        time: 30,
        score: 3,
    }), /Session owner was not found/);
    assert.equal(harness.createCount, 0);
});

test("failed session persistence does not update progress", async () => {
    let updates = 0;
    const repository: GameSessionRepository = {
        userExists: async () => true,
        createSession: async () => { throw new Error("save failed"); },
        getSessionsByUserId: async () => [],
        updateUserProgress: async () => { updates += 1; return true; },
    };
    const service = new GameSessionService(repository);

    await assert.rejects(service.createSession({ userId: USER_A, gameName: "image", time: 30 }), /save failed/);
    assert.equal(updates, 0);
});

const startTestServer = async (router: express.Router) => {
    const app = express();
    app.use(express.json());
    app.use("/api/game-sessions", router);
    app.use(errorHandlingMiddleware);
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    return {
        baseUrl: `http://127.0.0.1:${address.port}/api/game-sessions`,
        close: () => new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        }),
    };
};

test("the production game-session router requires authentication", async () => {
    const server = await startTestServer(gameSessionRouter);
    try {
        const response = await fetch(server.baseUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: USER_A, gameName: "card", time: 30, score: 1 }),
        });
        assert.equal(response.status, 401);
    } finally {
        await server.close();
    }
});

test("session creation is bound to the authenticated user", async () => {
    const harness = makeHarness();
    const authentication: RequestHandler = (request, _response, next) => {
        request.user = { _id: { toString: () => USER_A } } as unknown as UserDocument;
        next();
    };
    const router = createGameSessionRouter(authentication, harness.service);
    const server = await startTestServer(router);
    try {
        const spoofed = await fetch(server.baseUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: USER_B, gameName: "card", time: 30, score: 1 }),
        });
        assert.equal(spoofed.status, 403);

        const accepted = await fetch(server.baseUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gameName: "card", time: 30, score: 1 }),
        });
        assert.equal(accepted.status, 201);
        assert.equal(harness.createCount, 1);
        assert.equal(harness.progress.get(USER_A)?.exp, 1);

        const otherUsersHistory = await fetch(`${server.baseUrl}/user/${USER_B}`);
        assert.equal(otherUsersHistory.status, 403);
    } finally {
        await server.close();
    }
});