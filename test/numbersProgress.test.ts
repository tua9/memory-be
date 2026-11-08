import "./helpers/testEnv.js";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { test } from "node:test";
import { mongo, Types } from "mongoose";
import { createNumberSessionRouter } from "../src/routes/numberSessionRoute.js";
import { errorHandlingMiddleware } from "../src/middlewares/errorHandlingMiddleware.js";
import type { UserDocument } from "../src/models/user.js";
import { NUMBER_LEVEL_DIGITS, NUMBER_MAX_LEVEL } from "../src/config/numbers.js";
import type { NumberSessionDocument } from "../src/models/numberSession.js";
import type {
    CreateNumberSessionData,
    CompleteSessionData,
    NumberSessionRepository,
} from "../src/repositories/numberSession.repository.js";
import {
    NumberSessionService,
    validateCreateSessionInput,
} from "../src/services/numberSession.service.js";
import ApiError from "../src/utils/ApiError.js";

const USER = new Types.ObjectId().toString();

const isApiError = (status: number, code?: string) => (error: unknown) =>
    error instanceof ApiError && error.statusCode === status && (code === undefined || error.code === code);

// Repository trong bộ nhớ: đủ cho tạo ván, tìm cấp hoàn hảo cao nhất và ván thử thách theo ngày
const createMemoryRepository = (sessions: Partial<NumberSessionDocument>[] = []) => {
    const store = sessions.map((session) => ({ _id: new Types.ObjectId(), ...session }) as NumberSessionDocument);
    const repository = {
        create: async (data: CreateNumberSessionData) => {
            const duplicate = data.challengeDate && store.some((s) => s.challengeDate === data.challengeDate && String(s.userId) === String(data.userId));
            if (duplicate) throw new mongo.MongoServerError({ code: 11000, message: "duplicate challenge" });
            const doc = { _id: new Types.ObjectId(), ...data, recallStartedAt: null, recallEndsAt: null, completedAt: null, completionReason: null, memorizeUsedMs: null } as unknown as NumberSessionDocument;
            store.push(doc);
            return doc;
        },
        findByIdAndUser: async (id: string, userId: string) =>
            store.find((s) => String(s._id) === id && String(s.userId) === userId) ?? null,
        transitionToRecalling: async (id: string, _userId: string, recallStartedAt: Date, recallEndsAt: Date, memorizeUsedMs: number) => {
            const doc = store.find((s) => String(s._id) === id)!;
            Object.assign(doc, { phase: "recalling", recallStartedAt, recallEndsAt, memorizeUsedMs, revision: doc.revision + 1 });
            return doc;
        },
        completeSession: async (id: string, _userId: string, _revision: number | null, data: CompleteSessionData) => {
            const doc = store.find((s) => String(s._id) === id)!;
            Object.assign(doc, data, { revision: doc.revision + 1 });
            return doc;
        },
        completeExpiredSessionById: async (id: string, data: CompleteSessionData) => {
            const doc = store.find((s) => String(s._id) === id)!;
            Object.assign(doc, data, { revision: doc.revision + 1 });
            return doc;
        },
        findHighestPerfectLevel: async (userId: string) => {
            const levels = store
                .filter((s) => String(s.userId) === userId && s.mode === "practice" && s.phase === "completed" && s.level && s.correctCount === s.digitCount)
                .map((s) => s.level as number);
            return levels.length ? Math.max(...levels) : null;
        },
        findChallengeOn: async (userId: string, date: string) =>
            store.find((s) => String(s.userId) === userId && s.challengeDate === date) ?? null,
    } as unknown as NumberSessionRepository;
    return { repository, store };
};

const perfect = (level: number): Partial<NumberSessionDocument> => ({
    userId: new Types.ObjectId(USER),
    mode: "practice",
    phase: "completed",
    level,
    digitCount: NUMBER_LEVEL_DIGITS[level - 1],
    correctCount: NUMBER_LEVEL_DIGITS[level - 1],
});

// 10:00 sáng 8/11 giờ Việt Nam
const clock = () => new Date("2026-11-08T03:00:00Z");

test("a level picks its digit count from the level table", () => {
    assert.deepEqual(validateCreateSessionInput({ mode: "practice", level: 3, memorizeSeconds: 60, recallSeconds: 240 }), {
        mode: "practice",
        digitCount: NUMBER_LEVEL_DIGITS[2],
        memorizeSeconds: 60,
        recallSeconds: 240,
        level: 3,
    });
    // Frontend gửi kèm prepareRecall: trường lạ được bỏ qua như trước
    assert.equal(validateCreateSessionInput({ mode: "practice", level: 1, prepareRecall: true }).digitCount, NUMBER_LEVEL_DIGITS[0]);
});

test("level is validated and cannot be combined with digitCount or challenge", () => {
    for (const level of [0, NUMBER_MAX_LEVEL + 1, 2.5, "3"]) {
        assert.throws(() => validateCreateSessionInput({ mode: "practice", level }), isApiError(400));
    }
    assert.throws(() => validateCreateSessionInput({ mode: "practice", level: 2, digitCount: 12 }), isApiError(400));
    assert.throws(() => validateCreateSessionInput({ mode: "challenge", level: 2 }), isApiError(400));
    // Ván tự chọn và ván mặc định không có level
    assert.equal("level" in validateCreateSessionInput({ mode: "practice", digitCount: 20 }), false);
});

test("only unlocked levels can be played: a perfect round unlocks the next level", async () => {
    const fresh = new NumberSessionService(createMemoryRepository().repository, clock);
    const round = await fresh.createSession(USER, { mode: "practice", level: 1 });
    assert.equal(round.level, 1);
    assert.equal(round.digitCount, NUMBER_LEVEL_DIGITS[0]);
    await assert.rejects(fresh.createSession(USER, { mode: "practice", level: 2 }), isApiError(403, "LEVEL_LOCKED"));

    const afterTwo = new NumberSessionService(createMemoryRepository([perfect(1), perfect(2)]).repository, clock);
    assert.equal(await afterTwo.getUnlockedLevel(USER), 3);
    assert.equal((await afterTwo.createSession(USER, { mode: "practice", level: 3 })).digitCount, NUMBER_LEVEL_DIGITS[2]);
    await assert.rejects(afterTwo.createSession(USER, { mode: "practice", level: 4 }), isApiError(403, "LEVEL_LOCKED"));
});

test("an imperfect round, a custom round or another player's round does not unlock a level", async () => {
    const { repository } = createMemoryRepository([
        { ...perfect(3), correctCount: NUMBER_LEVEL_DIGITS[2] - 1 },
        { ...perfect(4), level: null },
        { ...perfect(5), userId: new Types.ObjectId() },
    ]);
    assert.equal(await new NumberSessionService(repository, clock).getUnlockedLevel(USER), 1);
});

test("the unlocked level never goes past the last level", async () => {
    const { repository } = createMemoryRepository([perfect(NUMBER_MAX_LEVEL)]);
    assert.equal(await new NumberSessionService(repository, clock).getUnlockedLevel(USER), NUMBER_MAX_LEVEL);
});

test("the challenge can be played once per day in Vietnam time", async () => {
    const { repository, store } = createMemoryRepository();
    const service = new NumberSessionService(repository, clock);
    const first = await service.createSession(USER, { mode: "challenge" });
    assert.equal(first.digitCount, 80);
    assert.equal(store[0].challengeDate, "2026-11-08");
    await assert.rejects(service.createSession(USER, { mode: "challenge" }), isApiError(403, "CHALLENGE_PLAYED"));

    // 17:30 UTC đã là 00:30 hôm sau ở Việt Nam: được chơi lượt mới
    const nextDay = new NumberSessionService(repository, () => new Date("2026-11-08T17:30:00Z"));
    assert.equal((await nextDay.createSession(USER, { mode: "challenge" })).digitCount, 80);
});

test("progress reports the unlocked level, the level table and today's challenge", async () => {
    const empty = new NumberSessionService(createMemoryRepository().repository, clock);
    assert.deepEqual(await empty.getProgress(USER), {
        unlockedLevel: 1,
        digitCounts: [...NUMBER_LEVEL_DIGITS],
        todayChallenge: { played: false },
    });

    const { repository } = createMemoryRepository([
        perfect(1),
        {
            userId: new Types.ObjectId(USER),
            mode: "challenge",
            phase: "completed",
            challengeDate: "2026-11-08",
            digitCount: 80,
            correctCount: 64,
            score: 64,
            accuracy: 80,
            memorizeUsedMs: 42_000,
        },
    ]);
    const progress = await new NumberSessionService(repository, clock).getProgress(USER);
    assert.equal(progress.unlockedLevel, 2);
    assert.deepEqual(progress.todayChallenge, {
        played: true,
        phase: "completed",
        digitCount: 80,
        score: 64,
        correctCount: 64,
        accuracy: 80,
        memorizeUsedMs: 42_000,
    });
});

test("submitting a perfect level persists progress across service instances and repeated submits", async () => {
    const { repository } = createMemoryRepository();
    const service = new NumberSessionService(repository, clock);
    const round = await service.createSession(USER, { level: 1 });
    assert.equal((await service.getProgress(USER)).unlockedLevel, 1);
    const recall = await service.startRecall(USER, round.id);
    await service.submitSession(USER, round.id, { revision: recall.revision, answers: round.digits });
    await service.submitSession(USER, round.id, { answers: [] });
    const restarted = new NumberSessionService(repository, clock);
    assert.equal((await restarted.getProgress(USER)).unlockedLevel, 2);
    assert.equal((await restarted.getResult(USER, round.id)).level, 1);
});

test("concurrent challenge starts allow only one session and isolate users", async () => {
    const { repository, store } = createMemoryRepository();
    const service = new NumberSessionService(repository, clock);
    const results = await Promise.allSettled([
        service.createSession(USER, { mode: "challenge" }),
        service.createSession(USER, { mode: "challenge" }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.ok(isApiError(403, "CHALLENGE_PLAYED")(rejected.reason));
    assert.equal(store.length, 1);
    const otherUser = new Types.ObjectId().toString();
    assert.deepEqual((await service.getProgress(otherUser)).todayChallenge, { played: false });
    await service.createSession(otherUser, { mode: "challenge" });
    assert.equal(store.length, 2);
});

test("progress reports an active challenge without scores and grades an abandoned challenge", async () => {
    const { repository, store } = createMemoryRepository();
    const service = new NumberSessionService(repository, clock);
    await service.createSession(USER, { mode: "challenge" });
    assert.deepEqual((await service.getProgress(USER)).todayChallenge, {
        played: true, phase: "memorizing", digitCount: 80,
    });
    const expired = new NumberSessionService(repository, () => new Date("2026-11-08T04:00:00Z"));
    const status = (await expired.getProgress(USER)).todayChallenge;
    assert.equal(status.phase, "completed");
    assert.equal(status.score, 0);
    assert.equal(store[0].completionReason, "timeout");
    assert.deepEqual((await expired.getProgress(USER)).todayChallenge, status);
});

test("GET /numbers/progress authenticates, disables caching and returns the frontend contract", async () => {
    const service = new NumberSessionService(createMemoryRepository().repository, clock);
    let authenticated = false;
    const app = express();
    app.use("/numbers", createNumberSessionRouter((req, _res, next) => {
        if (authenticated) req.user = { _id: new Types.ObjectId(USER) } as UserDocument;
        next();
    }, service));
    app.use(errorHandlingMiddleware);
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/numbers/progress`;
    try {
        assert.equal((await fetch(url)).status, 401);
        authenticated = true;
        const response = await fetch(url);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.deepEqual(await response.json(), {
            status: "success",
            data: { unlockedLevel: 1, digitCounts: [...NUMBER_LEVEL_DIGITS], todayChallenge: { played: false } },
        });
    } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
});
