import "./helpers/testEnv.js";
import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import mongoose, { Types } from "mongoose";
import { CONFIGURED_GAME_NAMES } from "../src/config/games.js";
import { getGameEngine, parseAnswers } from "../src/games/index.js";
import GameSession from "../src/models/gameSession.js";
import NumberSession, { type NumberSessionDocument } from "../src/models/numberSession.js";
import User from "../src/models/user.js";
import UserGameProgress from "../src/models/userGameProgress.js";
import GuestProgress from "../src/models/guestProgress.js";
import { numberSessionRepository } from "../src/repositories/numberSession.repository.js";
import { resolveRoundRules } from "../src/services/gameRules.service.js";
import { gameSessionService, toCompletedView, type GameSessionRecord } from "../src/services/gameSession.service.js";
import { createInitialGameProgress, createInitialUserProgress, settleRound } from "../src/services/roundSettlement.service.js";
import { numberSettlementSnapshot, recordNumberCompletion } from "../src/services/numberSettlement.service.js";
import { createSeededRandom } from "../src/utils/random.js";

afterEach(() => mock.restoreAll());
const USER = new Types.ObjectId().toString();
const now = new Date();
const settlementFor = (gameName: "facename" | "number", answers: (string | null)[], items?: string[]) => {
    const { gameName: _name, ...rules } = resolveRoundRules(gameName, { gameLevel: 1 }, 1);
    return settleRound({ gameName, rules, items: items ?? getGameEngine(gameName).generateItems(rules.totalItems, 1), answers,
        startedAt: new Date(now.getTime() - 20_000), recallStartedAt: new Date(now.getTime() - 10_000), completedAt: now },
        { gameProgress: createInitialGameProgress(), userProgress: createInitialUserProgress() });
};

test("every registered game generates valid rounds and can settle through the common core", () => {
    for (const name of CONFIGURED_GAME_NAMES) {
        const engine = getGameEngine(name);
        const { gameName: _name, ...rules } = resolveRoundRules(name, {}, 1);
        const items = engine.generateItems(rules.totalItems, 1);
        const answers = items.map((item) => name === "facename" ? engine.toView(item).label! : item);
        const parsed = parseAnswers(engine, items, answers);
        const result = settleRound({ gameName: name, rules, items, answers: parsed, startedAt: now, recallStartedAt: now, completedAt: now },
            { gameProgress: createInitialGameProgress(), userProgress: createInitialUserProgress() });
        assert.equal(result.graded.result, "perfect", name);
        assert.equal(result.gameProgress.unlockedLevel, 2, name);
        assert.ok(result.rewards.exp.total > 0, name);
    }
});

test("Numbers accepts repeated digits, preserves zero and requires a perfect level to unlock", () => {
    const engine = getGameEngine("number");
    const items = ["0", "0", "1", "1", "0", "0", "1", "1"];
    assert.deepEqual(parseAnswers(engine, items, items), items);
    assert.throws(() => parseAnswers(engine, items, ["00", ...items.slice(1)]));
    const imperfect = settlementFor("number", [...items.slice(0, 7), null], items);
    assert.equal(imperfect.gameProgress.unlockedLevel, 1);
    assert.equal(settlementFor("number", items, items).gameProgress.unlockedLevel, 2);
});

test("FaceName grades names with accents and snapshots penalty and per-level passing score", () => {
    const engine = getGameEngine("facename");
    const items = engine.generateItems(6, 1);
    const names = items.map((item) => engine.toView(item).label!);
    const pass = settlementFor("facename", [...names.slice(0, 4), null, null], items);
    const fail = settlementFor("facename", [...names.slice(0, 4), "wrong", null], items);
    assert.equal(pass.graded.score, 4);
    assert.equal(pass.gameProgress.unlockedLevel, 2);
    assert.equal(fail.graded.score, 3.5);
    assert.equal(fail.gameProgress.unlockedLevel, 1);
    assert.ok(engine.matches!(items[0], ` ${names[0].toUpperCase()} `));
    assert.equal(engine.toRecallView!(items[0]).label, undefined);
    assert.throws(() => parseAnswers(engine, items, Array(6).fill("x".repeat(101))));
    const highLevel = resolveRoundRules("facename", { gameLevel: 10 }, 10);
    assert.equal(highLevel.recallLimitSec, 300);
    assert.equal(highLevel.requiredScore, 20);
    assert.equal(highLevel.wrongAnswerPenalty, 0.5);
});

test("custom FaceName validates time and never unlocks levels", () => {
    const rules = resolveRoundRules("facename", { mode: "custom", itemCount: 3, memorizeSec: 20, recallSec: 90 }, 1);
    assert.equal(rules.recallLimitSec, 90);
    assert.throws(() => resolveRoundRules("facename", { mode: "custom", itemCount: 3, memorizeSec: 301 }, 1));
    assert.throws(() => resolveRoundRules("facename", { gameLevel: 2 }, 1));
    assert.throws(() => resolveRoundRules("card", { recallSec: 90 }, 1));
});

test("new game engines honor seeded randomness for future daily challenges", () => {
    for (const name of ["number", "facename"] as const) {
        const engine = getGameEngine(name);
        const count = name === "number" ? 8 : 6;
        assert.deepEqual(engine.generateItems(count, 1, createSeededRandom("same")), engine.generateItems(count, 1, createSeededRandom("same")));
    }
});

// Model doubles exercise the real service state machine and transaction boundary without a database.
const query = (value: unknown) => {
    const chain: any = { select: () => chain, lean: () => chain, session: () => chain, exec: async () => value };
    return chain;
};
const memoryModels = () => {
    const sessions = new Map<string, GameSessionRecord>();
    let progress = createInitialGameProgress();
    let userProgress = createInitialUserProgress();
    let awards = 0;
    mock.method(numberSessionRepository, "findHighestPerfectLevel", async () => null);
    mock.method(mongoose.connection, "transaction", async (callback: any) => callback({}));
    mock.method(UserGameProgress, "findOne", () => query(progress));
    mock.method(UserGameProgress, "updateOne", (_filter: any, update: any) => { progress = update.$set; return query({ modifiedCount: 1 }); });
    mock.method(User, "findById", () => query({ progress: userProgress }));
    mock.method(User, "updateOne", (_filter: any, update: any) => { awards++; userProgress = update.$set.progress; return query({ modifiedCount: 1 }); });
    mock.method(GameSession, "create", async (data: any) => {
        const session = { rewards: null, guestUnlockedLevel: null, ...data, _id: new Types.ObjectId(), completedAt: null, recallStartedAt: null, guestId: data.guestId ?? null, userId: data.userId ?? null };
        sessions.set(String(session._id), session); return session;
    });
    mock.method(GameSession, "findOne", (filter: any) => {
        const found = sessions.get(String(filter._id));
        const owns = found && (filter.guestId ? found.guestId === filter.guestId : String(found.userId) === String(filter.userId));
        return query(owns ? { ...found } : null);
    });
    mock.method(GameSession, "findOneAndUpdate", (filter: any, update: any) => {
        const found = sessions.get(String(filter._id));
        if (!found || found.status !== filter.status) return query(null);
        Object.assign(found, update.$set); return query(found);
    });
    mock.method(GameSession, "updateOne", (filter: any, update: any) => {
        let found = sessions.get(String(filter._id));
        if (!found && update.$setOnInsert) {
            found = { ...update.$setOnInsert }; sessions.set(String(filter._id), found!);
            return query({ modifiedCount: 0, upsertedCount: 1 });
        }
        if (!found || (filter.status && found.status !== filter.status)) return query({ modifiedCount: 0 });
        Object.assign(found, update.$set ?? {}); return query({ modifiedCount: 1 });
    });
    return { sessions, get awards() { return awards; }, get progress() { return progress; }, get userProgress() { return userProgress; } };
};

test("FaceName lifecycle enforces ownership, hides recall names and settles a repeated submit once", async () => {
    const memory = memoryModels();
    const player = { userId: USER };
    const started = await gameSessionService.startRound(player, { gameName: "facename", gameLevel: 1 });
    await assert.rejects(gameSessionService.startRecall({ userId: new Types.ObjectId().toString() }, started.sessionId));
    const recall = await gameSessionService.startRecall(player, started.sessionId);
    assert.ok(recall.recallOptions.every((item) => item.label === undefined));
    const answers = started.items.map((item) => item.label!);
    const first = await gameSessionService.submitRound(player, started.sessionId, { answers });
    const replay = await gameSessionService.submitRound(player, started.sessionId, { answers: [] });
    assert.equal(first.result.score, 6);
    assert.equal(replay.result.score, 6);
    assert.equal(first.result.perItem[0].answer?.label, answers[0]);
    assert.equal(memory.awards, 1);
    assert.equal(memory.progress.unlockedLevel, 2);
    assert.ok(memory.userProgress.exp > 0);
    assert.equal(toCompletedView(memory.sessions.get(started.sessionId)!).result.perItem.length, 6);
});

test("Numbers completion retries share the original id and award EXP only once", async () => {
    const memory = memoryModels();
    let marked = 0;
    mock.method(NumberSession, "updateOne", () => { marked++; return query({ modifiedCount: 1 }); });
    const source = { _id: new Types.ObjectId(), userId: new Types.ObjectId(USER), sharedProgress: true,
        phase: "completed", mode: "practice", level: 1, digitCount: 8,
        memorizeSeconds: 60, recallSeconds: 120, originalDigits: Array(8).fill("0"), answers: Array(8).fill("0"),
        startedAt: new Date(now.getTime() - 20_000), recallStartedAt: new Date(now.getTime() - 10_000), completedAt: now } as NumberSessionDocument;
    assert.equal(numberSettlementSnapshot(source).rules.mode, "level");
    await recordNumberCompletion(source);
    await recordNumberCompletion({ ...source, progressRecordedAt: null } as NumberSessionDocument);
    assert.equal(memory.sessions.size, 1);
    assert.equal(memory.awards, 1);
    assert.equal(marked, 2);
    assert.equal(memory.progress.stats.played, 1);
    assert.equal(memory.progress.unlockedLevel, 2);
    assert.equal(numberSettlementSnapshot({ ...source, mode: "challenge", level: null } as NumberSessionDocument).rules.mode, "daily");
});

test("guest Numbers are cookie-owned, unlock guest progress and never award account EXP", async () => {
    const memory = memoryModels();
    let guestWrites = 0;
    mock.method(GuestProgress, "findOne", () => query(null));
    mock.method(GuestProgress, "updateOne", (filter: any, update: any) => {
        assert.equal(filter.guestId, "g".repeat(32));
        assert.equal(filter.gameName, "number");
        assert.equal(update.$max.unlockedLevel, 2);
        guestWrites++;
        return query({ modifiedCount: 1 });
    });
    const guest = { guestId: "g".repeat(32) };
    const started = await gameSessionService.startRound(guest, { gameName: "number", gameLevel: 1 });
    await assert.rejects(gameSessionService.startRecall({ guestId: "x".repeat(32) }, started.sessionId), (error: any) => error.statusCode === 404);
    await assert.rejects(gameSessionService.startRecall({ userId: USER }, started.sessionId), (error: any) => error.statusCode === 404);
    await gameSessionService.startRecall(guest, started.sessionId);
    const answers = started.items.map((item) => item.code);
    const result = await gameSessionService.submitRound(guest, started.sessionId, { answers });
    assert.equal(result.rewards, null);
    assert.equal(result.result.result, "perfect");
    assert.equal(result.unlockedLevel.after, 2);
    await gameSessionService.submitRound(guest, started.sessionId, { answers: [] });
    assert.equal(guestWrites, 1);
    assert.equal(memory.awards, 0);
});
