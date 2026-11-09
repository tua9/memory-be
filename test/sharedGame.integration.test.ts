import "./helpers/testEnv.js";
import "../src/config/env.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose, { Types } from "mongoose";
import GameSession from "../src/models/gameSession.js";
import NumberSession from "../src/models/numberSession.js";
import User from "../src/models/user.js";
import UserGameProgress from "../src/models/userGameProgress.js";
import { MongoNumberSessionRepository } from "../src/repositories/numberSession.repository.js";
import { gameSessionService } from "../src/services/gameSession.service.js";
import { NumberSessionService } from "../src/services/numberSession.service.js";
import { recordNumberCompletion } from "../src/services/numberSettlement.service.js";
import { connectTestDB } from "./helpers/testDbGuard.js";

test("shared core Mongo transactions and Numbers reconciliation", { skip: !process.env.MONGODB_TEST_CONNECTION_STRING }, async (context) => {
    await connectTestDB();
    const userId = new Types.ObjectId();
    const player = { userId: String(userId) };
    try {
        await Promise.all([GameSession.init(), NumberSession.init(), UserGameProgress.init()]);
        await User.collection.insertOne({ _id: userId, username: "shared-core-test", email: `${userId}@test.invalid` });

        await context.test("FaceName concurrent submits produce one persisted reward and account progress", async () => {
            const started = await gameSessionService.startRound(player, { gameName: "facename", gameLevel: 1 });
            await gameSessionService.startRecall(player, started.sessionId);
            const payload = { answers: started.items.map((item) => item.label!) };
            const results = await Promise.all([
                gameSessionService.submitRound(player, started.sessionId, payload),
                gameSessionService.submitRound(player, started.sessionId, payload),
            ]);
            assert.equal(results[0].result.score, 6);
            assert.deepEqual(results[0].rewards, results[1].rewards);
            const progress = await UserGameProgress.findOne({ userId, gameName: "facename" }).lean().exec();
            assert.equal(progress?.unlockedLevel, 2);
            assert.equal(progress?.stats.played, 1);
            const account = await User.findById(userId).lean().exec();
            assert.equal(account?.progress.totalGames, 1);
            await assert.rejects(gameSessionService.startRecall({ userId: String(new Types.ObjectId()) }, started.sessionId));
        });

        await context.test("Numbers source survives a recording failure and retry reconciles once", async () => {
            const repository = new MongoNumberSessionRepository();
            let fail = true;
            const service = new NumberSessionService(repository, () => new Date(), async (source) => {
                if (fail) throw new Error("simulated recording failure");
                await recordNumberCompletion(source);
            });
            const started = await service.createSession(String(userId), { level: 1 });
            const recall = await service.startRecall(String(userId), started.id);
            await assert.rejects(service.submitSession(String(userId), started.id, { revision: recall.revision, answers: started.digits }));
            assert.equal((await NumberSession.findById(started.id).lean().exec())?.phase, "completed");
            fail = false;
            const retried = await service.getSession(String(userId), started.id);
            assert.equal(retried.result?.correctCount, 8);
            await service.getSession(String(userId), started.id);
            assert.equal(await GameSession.countDocuments({ _id: started.id, userId, gameName: "number", status: "completed" }), 1);
            const progress = await UserGameProgress.findOne({ userId, gameName: "number" }).lean().exec();
            assert.equal(progress?.stats.played, 1);
            assert.equal(progress?.unlockedLevel, 2);
            assert.ok((await NumberSession.findById(started.id).lean().exec())?.progressRecordedAt);
            assert.equal((await User.findById(userId).lean().exec())?.progress.totalGames, 2);
        });
    } finally {
        await Promise.all([
            GameSession.deleteMany({ userId }), NumberSession.deleteMany({ userId }),
            UserGameProgress.deleteMany({ userId }), User.deleteOne({ _id: userId }),
        ]);
        await mongoose.disconnect();
    }
});
