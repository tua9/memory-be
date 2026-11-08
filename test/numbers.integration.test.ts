import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import cookieParser from "cookie-parser";
import express, { type RequestHandler } from "express";
import mongoose from "mongoose";
import { connectTestDB } from "./helpers/testDbGuard.js";
import { errorHandlingMiddleware } from "../src/middlewares/errorHandlingMiddleware.js";
import NumberSession from "../src/models/numberSession.js";
import type { UserDocument } from "../src/models/user.js";
import {
    MongoNumberSessionRepository,
} from "../src/repositories/numberSession.repository.js";
import {
    createNumberSessionRouter,
} from "../src/routes/numberSessionRoute.js";
import {
    NumberSessionService,
} from "../src/services/numberSession.service.js";
import {
    sweepExpiredSessions,
} from "../src/services/numberSweep.service.js";

const USER_A_ID = "507f1f77bcf86cd799439011";
const USER_B_ID = "507f1f77bcf86cd799439022";

let currentUser = USER_A_ID;
let mockTime: Date = new Date();

const makeTestUser = (userId: string): UserDocument =>
    ({
        _id: new mongoose.Types.ObjectId(userId),
        username: `user_${userId}`,
        email: `${userId}@example.com`,
        status: "active",
        role: "user",
    }) as unknown as UserDocument;

const testAuthMiddleware: RequestHandler = (request, _response, next) => {
    if (!currentUser) {
        request.user = undefined;
    } else {
        request.user = makeTestUser(currentUser);
    }
    next();
};

const repository = new MongoNumberSessionRepository();
const testClock = () => new Date(mockTime.getTime());
const service = new NumberSessionService(repository, testClock);

const startTestServer = async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());

    const router = createNumberSessionRouter(testAuthMiddleware, service);
    app.use("/api/v1/numbers", router);
    app.use("/api/numbers", router);
    app.use(errorHandlingMiddleware);

    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;

    return {
        baseUrl: `http://127.0.0.1:${address.port}/api/v1/numbers`,
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            }),
    };
};

before(async () => {
    await connectTestDB();
    await NumberSession.init();
    // Clean up test sessions created by test users
    await NumberSession.deleteMany({
        userId: { $in: [USER_A_ID, USER_B_ID] },
    }).exec();
});

test("Mongo progress persists perfect levels and enforces one concurrent daily challenge", async () => {
    currentUser = USER_B_ID;
    mockTime = new Date("2026-11-08T03:00:00Z");
    try {
        const round = await service.createSession(USER_B_ID, { level: 1 });
        const recall = await service.startRecall(USER_B_ID, round.id);
        await service.submitSession(USER_B_ID, round.id, { revision: recall.revision, answers: round.digits });
        const restarted = new NumberSessionService(new MongoNumberSessionRepository(), testClock);
        assert.equal((await restarted.getProgress(USER_B_ID)).unlockedLevel, 2);
        assert.equal((await restarted.createSession(USER_B_ID, { level: 2 })).digitCount, 12);

        const starts = await Promise.allSettled([
            restarted.createSession(USER_B_ID, { mode: "challenge" }),
            restarted.createSession(USER_B_ID, { mode: "challenge" }),
        ]);
        assert.equal(starts.filter((result) => result.status === "fulfilled").length, 1);
        assert.equal(await NumberSession.countDocuments({ userId: USER_B_ID, challengeDate: "2026-11-08" }), 1);
        const rejected = starts.find((result) => result.status === "rejected") as PromiseRejectedResult;
        assert.equal(rejected.reason.code, "CHALLENGE_PLAYED");
        assert.equal((await restarted.getProgress(USER_B_ID)).todayChallenge.phase, "memorizing");
        mockTime = new Date("2026-11-08T04:00:00Z");
        assert.equal((await restarted.getProgress(USER_B_ID)).todayChallenge.phase, "completed");
    } finally {
        currentUser = USER_A_ID;
    }
});

after(async () => {
    if (mongoose.connection.readyState === 1) {
        await NumberSession.deleteMany({
            userId: { $in: [USER_A_ID, USER_B_ID] },
        }).exec();
        await mongoose.disconnect();
    }
});

test("unauthenticated requests are rejected with 401", async () => {
    const server = await startTestServer();
    try {
        currentUser = ""; // No user
        const response = await fetch(`${server.baseUrl}/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "practice" }),
        });
        const body = (await response.json()) as { statusCode: number; message: string };

        assert.equal(response.status, 401);
        assert.equal(body.statusCode, 401);
        assert.equal(body.message, "Unauthorized");
    } finally {
        await server.close();
        currentUser = USER_A_ID;
    }
});

test("full lifecycle: create -> recall early -> autosave answers -> submit -> get result", async () => {
    const server = await startTestServer();
    try {
        currentUser = USER_A_ID;
        mockTime = new Date("2026-10-24T10:00:00.000Z");

        // 1. Create session (practice, 6 digits, 30s memorize, 60s recall)
        const createRes = await fetch(`${server.baseUrl}/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                mode: "practice",
                digitCount: 6,
                memorizeSeconds: 30,
                recallSeconds: 60,
            }),
        });

        assert.equal(createRes.status, 201);
        assert.equal(createRes.headers.get("cache-control"), "no-store");
        const createBody = (await createRes.json()) as {
            data: {
                id: string;
                phase: string;
                digits: string[];
                revision: number;
                digitCount: number;
                serverNow: string;
            };
        };

        const sessionId = createBody.data.id;
        const originalDigits = createBody.data.digits;
        assert.equal(createBody.data.phase, "memorizing");
        assert.equal(originalDigits.length, 6);
        assert.equal(createBody.data.revision, 0);

        // 2. GET session during memorizing contains digits
        const getMemorizingRes = await fetch(`${server.baseUrl}/sessions/${sessionId}`);
        assert.equal(getMemorizingRes.status, 200);
        const getMemorizingBody = (await getMemorizingRes.json()) as {
            data: { phase: string; digits: string[]; answers?: unknown };
        };
        assert.equal(getMemorizingBody.data.phase, "memorizing");
        assert.deepEqual(getMemorizingBody.data.digits, originalDigits);
        assert.equal(getMemorizingBody.data.answers, undefined);

        // 3. Early transition to recall at 10:00:10 (10s used)
        mockTime = new Date("2026-10-24T10:00:10.000Z");
        const recallRes = await fetch(`${server.baseUrl}/sessions/${sessionId}/recall`, {
            method: "POST",
        });
        assert.equal(recallRes.status, 200);
        const recallBody = (await recallRes.json()) as {
            data: {
                phase: string;
                digits?: unknown;
                answers: (string | null)[];
                recallStartedAt: string;
                recallEndsAt: string;
                memorizeUsedMs: number;
                revision: number;
            };
        };

        assert.equal(recallBody.data.phase, "recalling");
        assert.equal(recallBody.data.digits, undefined, "Must NOT leak originalDigits in recalling phase");
        assert.equal(recallBody.data.answers.length, 6);
        assert.equal(recallBody.data.memorizeUsedMs, 10000);
        assert.equal(recallBody.data.revision, 1);

        // 4. Calling recall again does NOT reset recall deadline
        const repeatRecallRes = await fetch(`${server.baseUrl}/sessions/${sessionId}/recall`, {
            method: "POST",
        });
        const repeatRecallBody = (await repeatRecallRes.json()) as {
            data: { recallStartedAt: string; recallEndsAt: string; revision: number };
        };
        assert.equal(repeatRecallBody.data.recallStartedAt, recallBody.data.recallStartedAt);
        assert.equal(repeatRecallBody.data.recallEndsAt, recallBody.data.recallEndsAt);

        // 5. Autosave answers (at 10:00:20)
        mockTime = new Date("2026-10-24T10:00:20.000Z");
        const partialAnswers = [originalDigits[0], originalDigits[1], null, null, null, null];
        const saveRes = await fetch(`${server.baseUrl}/sessions/${sessionId}/answers`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                revision: 1,
                answers: partialAnswers,
            }),
        });

        assert.equal(saveRes.status, 200);
        const saveBody = (await saveRes.json()) as {
            data: { revision: number; answers: (string | null)[] };
        };
        assert.equal(saveBody.data.revision, 2);
        assert.deepEqual(saveBody.data.answers, partialAnswers);

        // 6. Stale revision autosave returns 409 REVISION_CONFLICT
        const staleSaveRes = await fetch(`${server.baseUrl}/sessions/${sessionId}/answers`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                revision: 1, // Stale!
                answers: partialAnswers,
            }),
        });
        assert.equal(staleSaveRes.status, 409);
        const staleSaveBody = (await staleSaveRes.json()) as { code: string };
        assert.equal(staleSaveBody.code, "REVISION_CONFLICT");

        // 7. Submit final answers (at 10:00:40)
        // 4 correct, 1 wrong, 1 blank
        mockTime = new Date("2026-10-24T10:00:40.000Z");
        const wrongDigit = originalDigits[4] === "0" ? "1" : "0";
        const finalAnswers = [
            originalDigits[0], // correct
            originalDigits[1], // correct
            originalDigits[2], // correct
            originalDigits[3], // correct
            wrongDigit,        // wrong
            null,              // blank
        ];

        const submitRes = await fetch(`${server.baseUrl}/sessions/${sessionId}/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                revision: 2,
                answers: finalAnswers,
            }),
        });

        assert.equal(submitRes.status, 200);
        const submitBody = (await submitRes.json()) as {
            data: {
                phase: string;
                completionReason: string;
                result: {
                    score: number;
                    accuracy: number;
                    correctCount: number;
                    wrongCount: number;
                    blankCount: number;
                };
                comparison: Array<{ index: number; status: string }>;
            };
        };

        assert.equal(submitBody.data.phase, "completed");
        assert.equal(submitBody.data.completionReason, "submitted");
        assert.equal(submitBody.data.result.correctCount, 4);
        assert.equal(submitBody.data.result.wrongCount, 1);
        assert.equal(submitBody.data.result.blankCount, 1);
        assert.equal(submitBody.data.result.score, 4);
        // 4 / 6 * 100 = 66.67
        assert.equal(submitBody.data.result.accuracy, 66.67);
        assert.equal(submitBody.data.comparison.length, 6);

        // 8. Submit again (double submit) returns identical saved result without error
        const doubleSubmitRes = await fetch(`${server.baseUrl}/sessions/${sessionId}/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ answers: ["0", "0", "0", "0", "0", "0"] }),
        });
        assert.equal(doubleSubmitRes.status, 200);
        const doubleSubmitBody = (await doubleSubmitRes.json()) as typeof submitBody;
        assert.equal(doubleSubmitBody.data.result.score, 4); // Did not re-grade!

        // 9. GET result endpoint
        const resultRes = await fetch(`${server.baseUrl}/sessions/${sessionId}/result`);
        assert.equal(resultRes.status, 200);
        const resultBody = (await resultRes.json()) as {
            data: { result: { score: number; accuracy: number }; comparison: unknown[] };
        };
        assert.equal(resultBody.data.result.score, 4);
        assert.equal(resultBody.data.result.accuracy, 66.67);
        assert.equal(resultBody.data.comparison.length, 6);
    } finally {
        await server.close();
    }
});

test("user isolation: User B cannot access User A's session", async () => {
    const server = await startTestServer();
    try {
        currentUser = USER_A_ID;
        mockTime = new Date("2026-10-24T11:00:00.000Z");

        // User A creates a session
        const createRes = await fetch(`${server.baseUrl}/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "practice", digitCount: 4 }),
        });
        const createBody = (await createRes.json()) as { data: { id: string } };
        const sessionId = createBody.data.id;

        // Switch to User B
        currentUser = USER_B_ID;

        // User B attempts GET session -> 404
        const getRes = await fetch(`${server.baseUrl}/sessions/${sessionId}`);
        assert.equal(getRes.status, 404);

        // User B attempts recall -> 404
        const recallRes = await fetch(`${server.baseUrl}/sessions/${sessionId}/recall`, {
            method: "POST",
        });
        assert.equal(recallRes.status, 404);

        // User B attempts answers -> 404
        const answersRes = await fetch(`${server.baseUrl}/sessions/${sessionId}/answers`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ revision: 0, answers: ["1", "2", "3", "4"] }),
        });
        assert.equal(answersRes.status, 404);

        // User B attempts submit -> 404
        const submitRes = await fetch(`${server.baseUrl}/sessions/${sessionId}/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ revision: 0, answers: ["1", "2", "3", "4"] }),
        });
        assert.equal(submitRes.status, 404);

        // User B attempts getResult -> 404
        const resultRes = await fetch(`${server.baseUrl}/sessions/${sessionId}/result`);
        assert.equal(resultRes.status, 404);
    } finally {
        await server.close();
        currentUser = USER_A_ID;
    }
});

test("invalid input validation: malformed ObjectId, bad practice params, challenge custom params", async () => {
    const server = await startTestServer();
    try {
        currentUser = USER_A_ID;

        // Invalid ObjectId
        const badIdRes = await fetch(`${server.baseUrl}/sessions/not-an-id`);
        assert.equal(badIdRes.status, 400);

        // Non-existent valid ObjectId
        const notFoundRes = await fetch(`${server.baseUrl}/sessions/507f1f77bcf86cd799439999`);
        assert.equal(notFoundRes.status, 404);

        // Challenge with custom params
        const badChallengeRes = await fetch(`${server.baseUrl}/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "challenge", digitCount: 20 }),
        });
        assert.equal(badChallengeRes.status, 400);

        // Practice with out-of-range params
        const badPracticeRes = await fetch(`${server.baseUrl}/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "practice", digitCount: 100 }),
        });
        assert.equal(badPracticeRes.status, 400);
    } finally {
        await server.close();
    }
});

test("timeout handling: overdue session auto-completes and late answers payload is rejected", async () => {
    const server = await startTestServer();
    try {
        currentUser = USER_A_ID;
        mockTime = new Date("2026-10-24T12:00:00.000Z");

        // Create session: 10s memorize, 20s recall
        const createRes = await fetch(`${server.baseUrl}/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                mode: "practice",
                digitCount: 4,
                memorizeSeconds: 10,
                recallSeconds: 20,
            }),
        });
        const createBody = (await createRes.json()) as {
            data: { id: string; digits: string[] };
        };
        const sessionId = createBody.data.id;
        const originalDigits = createBody.data.digits;

        // Transition to recall at 12:00:05
        mockTime = new Date("2026-10-24T12:00:05.000Z");
        await fetch(`${server.baseUrl}/sessions/${sessionId}/recall`, { method: "POST" });

        // Save 2 correct answers at 12:00:10
        mockTime = new Date("2026-10-24T12:00:10.000Z");
        await fetch(`${server.baseUrl}/sessions/${sessionId}/answers`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                revision: 1,
                answers: [originalDigits[0], originalDigits[1], null, null],
            }),
        });

        // Time travel to 12:00:30 (recallEndsAt was 12:00:25, so 5s overdue)
        mockTime = new Date("2026-10-24T12:00:30.000Z");

        // Attempt submit with all correct answers after deadline
        const lateSubmitRes = await fetch(`${server.baseUrl}/sessions/${sessionId}/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                revision: 2,
                answers: [originalDigits[0], originalDigits[1], originalDigits[2], originalDigits[3]],
            }),
        });

        assert.equal(lateSubmitRes.status, 200);
        const lateSubmitBody = (await lateSubmitRes.json()) as {
            data: {
                phase: string;
                completionReason: string;
                result: { score: number; correctCount: number; wrongCount: number; blankCount: number };
            };
        };

        // Late answers were IGNORED! Only the 2 saved answers are graded
        assert.equal(lateSubmitBody.data.phase, "completed");
        assert.equal(lateSubmitBody.data.completionReason, "timeout");
        assert.equal(lateSubmitBody.data.result.correctCount, 2);
        assert.equal(lateSubmitBody.data.result.score, 2);
        assert.equal(lateSubmitBody.data.result.blankCount, 2);
    } finally {
        await server.close();
    }
});

test("GET automatically transitions session to completed when both deadlines expired", async () => {
    const server = await startTestServer();
    try {
        currentUser = USER_A_ID;
        mockTime = new Date("2026-10-24T13:00:00.000Z");

        // Create session: 10s memorize, 20s recall
        const createRes = await fetch(`${server.baseUrl}/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                mode: "practice",
                digitCount: 4,
                memorizeSeconds: 10,
                recallSeconds: 20,
            }),
        });
        const createBody = (await createRes.json()) as { data: { id: string } };
        const sessionId = createBody.data.id;

        // User abandons session, time advances 10 minutes
        mockTime = new Date("2026-10-24T13:10:00.000Z");

        // When user calls GET, session is synchronized and completed with timeout
        const getRes = await fetch(`${server.baseUrl}/sessions/${sessionId}`);
        assert.equal(getRes.status, 200);
        const getBody = (await getRes.json()) as {
            data: { phase: string; completionReason: string; result: { score: number } };
        };

        assert.equal(getBody.data.phase, "completed");
        assert.equal(getBody.data.completionReason, "timeout");
        assert.equal(getBody.data.result.score, 0);
    } finally {
        await server.close();
    }
});

test("sweepExpiredSessions background worker cleans up expired sessions in DB", async () => {
    currentUser = USER_A_ID;
    mockTime = new Date("2026-10-24T14:00:00.000Z");

    // Create session directly via service
    const session = await service.createSession(USER_A_ID, {
        mode: "practice",
        digitCount: 4,
        memorizeSeconds: 10,
        recallSeconds: 20,
    });

    // Time advances past both deadlines
    const futureTime = new Date("2026-10-24T14:05:00.000Z");

    // Run sweep worker
    const processed = await sweepExpiredSessions(service, repository, futureTime);
    assert.equal(processed >= 1, true);

    // Verify session in DB is now completed
    const updated = await repository.findByIdAndUser(session.id, USER_A_ID);
    assert.equal(updated?.phase, "completed");
    assert.equal(updated?.completionReason, "timeout");
});

test("history list with pagination, filtering, and never leaks originalDigits", async () => {
    const server = await startTestServer();
    try {
        currentUser = USER_A_ID;
        mockTime = new Date("2026-10-24T15:00:00.000Z");

        // Clean previous sessions for this test user
        await NumberSession.deleteMany({ userId: USER_A_ID }).exec();

        // Create 3 practice sessions
        for (let i = 0; i < 3; i++) {
            await fetch(`${server.baseUrl}/sessions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode: "practice", digitCount: 4 + i }),
            });
        }

        // Create 1 challenge session
        await fetch(`${server.baseUrl}/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "challenge" }),
        });

        // Query history with pagination limit=2
        const histRes = await fetch(`${server.baseUrl}/sessions?page=1&limit=2`);
        assert.equal(histRes.status, 200);
        const histBody = (await histRes.json()) as {
            data: {
                items: Array<{ id: string; mode: string; originalDigits?: unknown; digits?: unknown }>;
                pagination: { total: number; page: number; limit: number; totalPages: number };
            };
        };

        assert.equal(histBody.data.items.length, 2);
        assert.equal(histBody.data.pagination.total, 4);
        assert.equal(histBody.data.pagination.totalPages, 2);

        // Verify history does not leak digits
        for (const item of histBody.data.items) {
            assert.equal(item.originalDigits, undefined);
            assert.equal(item.digits, undefined);
        }

        // Filter by mode=challenge
        const challengeHistRes = await fetch(`${server.baseUrl}/sessions?mode=challenge`);
        const challengeHistBody = (await challengeHistRes.json()) as typeof histBody;
        assert.equal(challengeHistBody.data.items.length, 1);
        assert.equal(challengeHistBody.data.items[0].mode, "challenge");
    } finally {
        await server.close();
    }
});
